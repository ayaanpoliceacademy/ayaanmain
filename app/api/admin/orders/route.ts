import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch } from "@/lib/branch-scope";
import { audit } from "@/lib/identifiers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  // Campus scoping via the customer's registered campus
  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  let userWhere: any = {};
  if (scope.branches !== null) userWhere = { branch: { in: scope.branches } };
  else if (requested.branch) userWhere = { branch: requested.branch };
  const scoped = Object.keys(userWhere).length > 0 ? { user: userWhere } : {};
  const [orders, newCount] = await Promise.all([
    prisma.storeOrder.findMany({
      where: { ...(status && status !== "all" ? { status } : {}), ...scoped },
      include: { items: true, events: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.storeOrder.count({ where: { status: { in: ["placed", "payment_confirmed"] }, ...scoped } }),
  ]);
  return NextResponse.json({ orders, newCount }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, action, note } = body;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });

  const order = await prisma.storeOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const actor = String(auth.session.username || auth.session.name || "admin");

const setStatus = async (status: string, extra: any = {}, eventAction: string, eventNote?: string) => {
    const updated = await prisma.storeOrder.update({ where: { id }, data: { status, ...extra } });
    await prisma.orderEvent.create({ data: { orderId: id, actor, action: eventAction, note: eventNote || note || null } });
    await audit("order", id, actor, eventAction, `${order.orderNo} ${order.status} -> ${status} (${order.name})`);
    return NextResponse.json(updated);
  };

  switch (action) {
    case "start_processing":
      if (!["placed", "payment_confirmed"].includes(order.status)) {
        return NextResponse.json({ error: `Cannot process from ${order.status}` }, { status: 400 });
      }
      return setStatus("processing", {}, "order_processed", "Moved to processing");
    case "mark_ready":
      if (!["processing", "payment_confirmed", "placed"].includes(order.status)) {
        return NextResponse.json({ error: `Cannot mark ready from ${order.status}` }, { status: 400 });
      }
      return setStatus("ready_for_handover", {}, "order_ready", "Ready for handover");
    case "handover":
      if (!["ready_for_handover", "processing", "payment_confirmed"].includes(order.status)) {
        return NextResponse.json({ error: `Cannot hand over from ${order.status}` }, { status: 400 });
      }
      return setStatus(
        "handed_over",
        { handedOverAt: new Date(), handedOverBy: actor },
        "order_handed_over",
        `Handed over by ${actor}${note ? ` — ${note}` : ""}`
      );
    case "complete":
      if (order.status !== "handed_over") {
        return NextResponse.json({ error: "Only handed-over orders can be completed" }, { status: 400 });
      }
      return setStatus("completed", {}, "order_completed", "Order completed");
    case "cancel":
      if (["handed_over", "completed"].includes(order.status)) {
        return NextResponse.json({ error: "Cannot cancel after handover" }, { status: 400 });
      }
      return setStatus("cancelled", {}, "order_cancelled", note || "Cancelled by admin");
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
