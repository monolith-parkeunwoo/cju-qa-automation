import { normalizeSlots } from "../packages/contracts/availability.ts";
import { z } from "zod";
import { QaError } from "./engine.ts";
import type {
  ReservationInput,
  VerifiedOrder,
} from "../packages/contracts/index.ts";
const identifier = z.union([z.string(), z.number()]).transform(String);
const orderSchema = z.object({
  orderId: identifier,
  reservationId: z.string(),
  orderStatus: z.string(),
  orderProducts: z
    .array(
      z.object({
        product: z.object({ productId: identifier }),
        reservationTime: z.object({
          boardingDate: z.string(),
          boardingTime: z.string(),
        }),
      }),
    )
    .min(1),
});
export function normalizeDevelopmentOrder(value: unknown): VerifiedOrder {
  const d = orderSchema.parse(value);
  const first = d.orderProducts[0];
  if (
    !d.orderProducts.every(
      (p) =>
        p.product.productId === first.product.productId &&
        p.reservationTime.boardingDate === first.reservationTime.boardingDate &&
        p.reservationTime.boardingTime === first.reservationTime.boardingTime,
    )
  )
    throw new QaError("VERIFICATION_MISMATCH");
  return {
    orderId: d.orderId,
    reservationId: d.reservationId,
    productId: first.product.productId,
    date: first.reservationTime.boardingDate,
    time: first.reservationTime.boardingTime.slice(0, 5),
    quantity: d.orderProducts.length,
    completed: d.orderStatus === "COMPLETED",
  };
}
export type Credentials = Record<
  "product" | "order" | "ticket",
  { id: string; secret: string }
>;
const productSchema = z.object({
  productId: z.literal(116),
  enabled: z.literal(true),
  approvedStatus: z.literal("APPROVED"),
  salePrice: z.object({
    currencyCode: z.literal("KRW"),
    priceAmount: z.number().positive(),
  }),
  originalPrice: z.object({ priceAmount: z.number().positive() }),
  operatingStopYn: z.literal(false),
  outOfOperationYn: z.literal(false),
});
export class DevelopmentApi {
  private tokens = new Map<string, { value: string; expires: number }>();
  constructor(
    private credentials: Credentials,
    private transport: typeof fetch = fetch,
  ) {}
  private async token(service: keyof Credentials) {
    const previous = this.tokens.get(service);
    if (previous && previous.expires > Date.now() + 30000)
      return previous.value;
    const c = this.credentials[service];
    if (!c?.id || !c.secret) throw new QaError("AUTH");
    let r: Response;
    try {
      r = await this.transport(
        "https://dev-accounts.sgp.981park.com/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(c.id + ":" + c.secret).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "api.write api.read",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        },
      );
    } catch {
      throw new QaError("AUTH");
    }
    if (!r.ok) throw new QaError("AUTH");
    const b = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().optional(),
      })
      .parse(await r.json());
    this.tokens.set(service, {
      value: b.access_token,
      expires: Date.now() + (b.expires_in ?? 60) * 1000,
    });
    return b.access_token;
  }
  private async request(
    service: keyof Credentials,
    path: string,
    method = "GET",
    body?: unknown,
  ) {
    const token = await this.token(service);
    if (!/^\/(product|stock|order|ticket)\//.test(path))
      throw new QaError("CONTRACT_ERROR");
    let r: Response;
    try {
      r = await this.transport(`https://dev-api.cju.981park.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept-Language": "ko-kr",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new QaError(
        method === "GET" ? "CONTRACT_ERROR" : "UNCERTAIN_MUTATION",
        method !== "GET",
      );
    }
    if (r.status === 401 || r.status === 403) throw new QaError("AUTH");
    if (!r.ok)
      throw new QaError("API_REJECTED", method !== "GET" && r.status >= 500);
    let b;
    try {
      b = z
        .object({ code: z.string(), data: z.unknown().optional() })
        .parse(await r.json());
    } catch {
      throw new QaError("CONTRACT_ERROR", method !== "GET");
    }
    if (b.code !== "00000") throw new QaError("API_REJECTED");
    return b;
  }
  async product(date: string) {
    const b = await this.request(
      "product",
      `/product/os/v1/products?channelCodes=INFO_DESK&startDate=${encodeURIComponent(date)}&endDate=${encodeURIComponent(date)}`,
    );
    const products = z
      .array(z.object({ productId: z.number() }).passthrough())
      .parse(b.data);
    return productSchema.parse(products.find((p) => p.productId === 116));
  }
  async availability(date: string, quantity: number) {
    const b = await this.request(
      "product",
      `/stock/v1/stocks/availability/date/${encodeURIComponent(date)}/prdId/116/quantity/${quantity}/location/INFO_DESK`,
    );
    return z
      .object({
        timeList: z.array(
          z.object({ timeSlot: z.string(), enabled: z.boolean() }),
        ),
      })
      .parse(b.data).timeList;
  }
  async readOrder(id: string) {
    return normalizeDevelopmentOrder(
      (
        await this.request(
          "order",
          `/order/os/v1/orders/${encodeURIComponent(id)}`,
        )
      ).data,
    );
  }
  reservationPort(
    orderer: { name: string; phone: string; regId: number },
    expectedPrice: number,
  ) {
    let price: number | undefined;
    return {
      productId: "116",
      preflight: async (input: ReservationInput) => {
        await this.token("order");
        const product = await this.product(input.date);
        if (
          product.salePrice.priceAmount !== expectedPrice ||
          !normalizeSlots(await this.availability(input.date, input.quantity)).some(
            (s) => s.time === input.time && s.enabled,
          )
        )
          throw new QaError("PRECONDITION");
        price = product.salePrice.priceAmount;
      },
      create: async (input: ReservationInput) => {
        if (price === undefined) throw new QaError("PRECONDITION");
        const product = {
          productId: 116,
          reservationType: "FIXED",
          boardingDate: input.date,
          boardingTime: input.time,
          currencyCode: "KRW",
          priceAmount: price,
          salePriceAmount: price,
          discountPriceAmount: 0,
          promotionId: null,
          couponCode: null,
          manualPromotionId: null,
          manualDiscountType: null,
          manualFixedDiscountPriceAmount: null,
          manualDiscountPercentageOff: null,
          manualDiscountMemo: null,
        };
        const b = await this.request("order", "/order/os/v1/orders", "POST", {
          channel: "INFO_DESK",
          ordererName: orderer.name,
          ordererPhone: orderer.phone,
          ordererEmail: null,
          ordererInfo: "테스트",
          orderProducts: Array.from({ length: input.quantity }, () => product),
          regId: orderer.regId,
        });
        return z.object({ orderId: identifier }).parse(b.data).orderId;
      },
      complete: async (id: string) => {
        await this.request(
          "order",
          `/order/os/v1/orders/${encodeURIComponent(id)}/complete`,
          "POST",
          { payType: "CARD" },
        );
      },
      read: (id: string) => this.readOrder(id),
    };
  }
  ticketPort(orderId: string, reservationId: string, input: ReservationInput) {
    return {
      validate: async () => {
        const order = await this.readOrder(orderId);
        if (
          order.reservationId !== reservationId ||
          !order.completed ||
          order.productId !== "116" ||
          order.quantity !== input.quantity ||
          order.date !== input.date ||
          order.time !== input.time
        )
          throw new QaError("PRECONDITION");
        await this.token("ticket");
      },
      print: async () =>
        this.request(
          "ticket",
          `/ticket/v1/reservation/order/${encodeURIComponent(reservationId)}/test-virtual-print`,
          "POST",
        ),
      read: async (id: string) =>
        (
          await this.request(
            "ticket",
            `/ticket/v1/reservation/ticket/wearable/info/${encodeURIComponent(id)}`,
          )
        ).data,
    };
  }
}
