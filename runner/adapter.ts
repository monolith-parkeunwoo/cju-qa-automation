import { z } from "zod";
import { idSchema, inputSchema } from "../packages/contracts/index.ts";
import type {
  ReservationInput,
  VerifiedOrder,
} from "../packages/contracts/index.ts";
import { QaError } from "./engine.ts";
const pointer = z.string().regex(/^\//);
const readCheck = z
  .object({
    kind: z.enum(["product", "price", "availability"]),
    path: z.string().startsWith("/"),
    pointer,
    expected: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();
export const contractSchema = z
  .object({
    version: z.string().min(1),
    environment: z.literal("development"),
    verifiedAt: z.string().datetime(),
    evidence: z.string().min(10),
    baseUrl: z
      .string()
      .url()
      .refine(
        (v) =>
          new URL(v).protocol === "https:" &&
          !new URL(v).username &&
          !new URL(v).password,
      ),
    productId: idSchema,
    productIdType: z.enum(["string", "number"]),
    price: z.number().nonnegative(),
    times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1),
    quantityEncoding: z.literal("repeatedOrderProducts"),
    payType: z.enum(["CARD", "CASH"]),
    preflight: z
      .array(readCheck)
      .min(3)
      .refine((v) =>
        ["product", "price", "availability"].every((k) =>
          v.some((c) => c.kind === k),
        ),
      ),
    success: z
      .object({ pointer, expected: z.union([z.string(), z.number()]) })
      .strict(),
    createOrderId: pointer,
    read: z
      .object({
        path: z
          .string()
          .startsWith("/")
          .refine((v) => v.includes("{orderId}")),
        orderId: pointer,
        reservationId: pointer,
        productId: pointer,
        date: pointer,
        time: pointer,
        quantity: pointer,
        status: pointer,
        completedValue: z.union([z.string(), z.number()]),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const id = c.productIdType === "number" ? Number(c.productId) : c.productId;
    if (
      c.productIdType === "number" &&
      (!Number.isSafeInteger(id) || Number(id) <= 0)
    )
      ctx.addIssue({ code: "custom", message: "Invalid numeric product ID" });
    if (
      !c.preflight.some((v) => v.kind === "product" && v.expected === id) ||
      !c.preflight.some((v) => v.kind === "price" && v.expected === c.price)
    )
      ctx.addIssue({
        code: "custom",
        message: "Preflight must verify the configured product and price",
      });
  });
export type Contract = z.infer<typeof contractSchema>;
export function at(value: unknown, path: string): unknown {
  return path
    .slice(1)
    .split("/")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? Object.hasOwn(v, k.replace(/~1/g, "/").replace(/~0/g, "~"))
            ? (v as Record<string, unknown>)[
                k.replace(/~1/g, "/").replace(/~0/g, "~")
              ]
            : undefined
          : undefined,
      value,
    );
}
const scalar = (v: unknown) => {
  if (typeof v !== "string" && typeof v !== "number")
    throw new QaError("CONTRACT_ERROR");
  return String(v);
};
export class OsReservationAdapter {
  productId: string;
  constructor(
    private c: Contract,
    private token: string,
    private orderer: { name: string; phone: string; regId: number },
    private transport: typeof fetch = fetch,
  ) {
    this.productId = c.productId;
  }
  private async request(path: string, method = "GET", payload?: unknown) {
    const url = new URL(path, this.c.baseUrl);
    if (url.origin !== new URL(this.c.baseUrl).origin)
      throw new QaError("CONTRACT_ERROR");
    let r: Response;
    try {
      r = await this.transport(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "Accept-Language": "ko-kr",
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch {
      throw new QaError(
        method === "GET" ? "CONTRACT_ERROR" : "UNCERTAIN_MUTATION",
        method !== "GET",
      );
    }
    if (r.status === 401 || r.status === 403) throw new QaError("AUTH");
    if (!r.ok)
      throw new QaError(
        r.status >= 500 ? "UNCERTAIN_MUTATION" : "API_REJECTED",
        method !== "GET" && r.status >= 500,
      );
    let v;
    try {
      v = await r.json();
    } catch {
      throw new QaError("CONTRACT_ERROR", method !== "GET");
    }
    if (at(v, this.c.success.pointer) !== this.c.success.expected)
      throw new QaError("API_REJECTED", method !== "GET");
    return v;
  }
  async preflight(input: ReservationInput) {
    inputSchema.parse(input);
    if (
      !this.token ||
      !this.orderer.name ||
      !this.orderer.phone ||
      !this.orderer.regId
    )
      throw new QaError("AUTH");
    if (!this.c.times.includes(input.time)) throw new QaError("PRECONDITION");
    for (const check of this.c.preflight) {
      const path = check.path
        .replaceAll("{date}", encodeURIComponent(input.date))
        .replaceAll("{time}", encodeURIComponent(input.time))
        .replaceAll("{quantity}", String(input.quantity))
        .replaceAll("{productId}", encodeURIComponent(this.c.productId));
      const value = await this.request(path);
      if (at(value, check.pointer) !== check.expected)
        throw new QaError("PRECONDITION");
    }
  }
  async create(input: ReservationInput) {
    const product = {
      productId:
        this.c.productIdType === "number"
          ? Number(this.c.productId)
          : this.c.productId,
      reservationType: "FIXED",
      boardingDate: input.date,
      boardingTime: input.time,
      currencyCode: "KRW",
      priceAmount: this.c.price,
      salePriceAmount: this.c.price,
      discountPriceAmount: 0,
      promotionId: null,
      couponCode: null,
      manualPromotionId: null,
      manualDiscountType: null,
      manualFixedDiscountPriceAmount: null,
      manualDiscountPercentageOff: null,
      manualDiscountMemo: null,
    };
    const result = await this.request("/os/v1/orders", "POST", {
      channel: "INFO_DESK",
      ordererName: this.orderer.name,
      ordererPhone: this.orderer.phone,
      ordererEmail: null,
      ordererInfo: "QA",
      orderProducts: Array.from({ length: input.quantity }, () => product),
      regId: this.orderer.regId,
    });
    const id = scalar(at(result, this.c.createOrderId));
    if (!idSchema.safeParse(id).success)
      throw new QaError("CONTRACT_ERROR", true);
    return id;
  }
  async complete(id: string) {
    await this.request(
      `/os/v1/orders/${encodeURIComponent(id)}/complete`,
      "POST",
      { payType: this.c.payType },
    );
  }
  async read(id: string): Promise<VerifiedOrder> {
    const m = this.c.read;
    const v = await this.request(
      m.path.replace("{orderId}", encodeURIComponent(id)),
    );
    const quantity = at(v, m.quantity);
    if (typeof quantity !== "number") throw new QaError("CONTRACT_ERROR");
    return {
      orderId: scalar(at(v, m.orderId)),
      reservationId: scalar(at(v, m.reservationId)),
      productId: scalar(at(v, m.productId)),
      date: scalar(at(v, m.date)),
      time: scalar(at(v, m.time)),
      quantity,
      completed: at(v, m.status) === m.completedValue,
    };
  }
}
