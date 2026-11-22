import { z } from "zod";
import {
  isValidAccountNumber,
  isValidGstin,
  isValidIfsc,
  isValidUpi,
  isValidIndianMobile,
  normalizeAccount,
  normalizeGstin,
  normalizeIfsc,
  normalizePhone,
  normalizeUpi,
} from "@/lib/validation";

/** Error messages are i18n keys under "validation". */
const opt = (s: z.ZodType<string>) => s.optional().or(z.literal("")).transform((v) => (v ? v : undefined));

export const ifscSchema = z
  .string()
  .transform(normalizeIfsc)
  .refine(isValidIfsc, "ifsc");
export const accountSchema = z
  .string()
  .transform(normalizeAccount)
  .refine(isValidAccountNumber, "account");
export const upiSchema = z.string().transform(normalizeUpi).refine(isValidUpi, "upi");
export const gstinSchema = z.string().transform(normalizeGstin).refine(isValidGstin, "gstin");
export const phoneSchema = z.string().transform(normalizePhone).refine(isValidIndianMobile, "phone");

export const bankDetailsSchema = z
  .object({
    accountHolderName: opt(z.string().trim().max(120)),
    accountNumber: opt(accountSchema),
    accountNumberConfirm: z.string().optional(),
    ifsc: opt(ifscSchema),
    bankName: opt(z.string().trim().max(120)),
    branch: opt(z.string().trim().max(160)),
    upiId: opt(upiSchema),
    /** true when typed by hand → must be entered twice */
    requireConfirm: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.accountNumber && !v.ifsc) ctx.addIssue({ code: "custom", path: ["ifsc"], message: "ifscRequired" });
    if (v.ifsc && !v.accountNumber) ctx.addIssue({ code: "custom", path: ["accountNumber"], message: "accountRequired" });
    if (v.accountNumber && v.requireConfirm && normalizeAccount(v.accountNumberConfirm ?? "") !== v.accountNumber) {
      ctx.addIssue({ code: "custom", path: ["accountNumberConfirm"], message: "accountMismatch" });
    }
    if (v.accountNumber && !v.accountHolderName) {
      ctx.addIssue({ code: "custom", path: ["accountHolderName"], message: "holderRequired" });
    }
  });
export type BankDetailsInput = z.input<typeof bankDetailsSchema>;

export const vendorProfileSchema = z.object({
  displayName: z.string().trim().min(1, "required").max(120),
  legalName: opt(z.string().trim().max(160)),
  gstin: opt(gstinSchema),
  phone: opt(phoneSchema),
  email: opt(z.email("email")),
  creditDays: z.coerce.number().int().min(0, "creditDays").max(365, "creditDays").default(30),
  notes: opt(z.string().trim().max(1000)),
});
export type VendorProfileInput = z.input<typeof vendorProfileSchema>;

export const billSchema = z.object({
  vendorId: z.uuid("vendor"),
  invoiceNumber: z.string().trim().min(1, "required").max(60),
  invoiceDate: opt(z.iso.date("date")),
  dueDate: opt(z.iso.date("date")),
  amountPaise: z.number().int().positive("amount"),
  gstin: opt(gstinSchema),
  notes: opt(z.string().trim().max(1000)),
  source: z.enum(["manual", "import", "invoice_image", "invoice_pdf"]).default("manual"),
  allowDuplicate: z.boolean().optional(),
});
export type BillInput = z.input<typeof billSchema>;
