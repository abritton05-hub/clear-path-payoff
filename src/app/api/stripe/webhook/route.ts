import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { PLAN_CONFIG, getPlanByPriceId } from "@/lib/plans";
import { getSupabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function isActiveStatus(status: Stripe.Subscription.Status) {
  return status === "active" || status === "trialing";
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!secret) {
    return NextResponse.json({ ok: false, error: "Missing webhook secret" });
  }

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Invalid signature" });
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase server client not configured" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      if (session.mode === "payment") {
        if (userId) {
          await supabase
            .from("profiles")
            .update({
              is_pro: true,
              pro_plan: "lifetime",
              pro_expires_at: null,
              stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
              stripe_subscription_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
        }
      }

      if (session.mode === "subscription" && userId && typeof session.subscription === "string") {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0]?.price?.id ?? "";
        const planType = getPlanByPriceId(priceId);
        const proExpiresAt = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        await supabase
          .from("profiles")
          .update({
            is_pro: true,
            pro_plan: planType,
            pro_expires_at: proExpiresAt,
            stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : null,
            stripe_subscription_id: subscription.id,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      }
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const isActive = isActiveStatus(subscription.status);
      const priceId = subscription.items.data[0]?.price?.id ?? "";
      const planType = getPlanByPriceId(priceId);
      const proExpiresAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;

      const update = {
        is_pro: isActive,
        pro_plan: planType,
        pro_expires_at: isActive ? proExpiresAt : proExpiresAt,
        stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : null,
        stripe_subscription_id: subscription.id,
        updated_at: new Date().toISOString(),
      };

      const metadataUserId = subscription.metadata?.supabase_user_id;
      if (metadataUserId) {
        await supabase.from("profiles").update(update).eq("user_id", metadataUserId);
      } else if (typeof subscription.customer === "string") {
        await supabase.from("profiles").update(update).eq("stripe_customer_id", subscription.customer);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : "";

      if (subscription.id || customerId) {
        await supabase
          .from("profiles")
          .update({
            is_pro: false,
            pro_plan: null,
            pro_expires_at: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          })
          .or(
            [
              subscription.id ? `stripe_subscription_id.eq.${subscription.id}` : null,
              customerId ? `stripe_customer_id.eq.${customerId}` : null,
            ]
              .filter(Boolean)
              .join(",")
          );
      }
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Webhook handler error" });
  }

  return NextResponse.json({ ok: true });
}
