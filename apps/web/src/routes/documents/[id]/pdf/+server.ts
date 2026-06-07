import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// GET /documents/:id/pdf — stream the stored PDF (0021). Agency-scoped via RLS
// (authed supabase client). 404 if the document has no rendered PDF.
export const GET: RequestHandler = async ({ locals, params }) => {
  const agencyId = locals.agencyId;
  if (!agencyId) error(403, "No agency context");

  const { data, error: dbErr } = await locals.supabase
    .from("documents")
    .select("title, pdf_base64")
    .eq("agency_id", agencyId)
    .eq("id", params.id)
    .maybeSingle();
  if (dbErr) error(500, "Failed to load document");
  if (!data?.pdf_base64) error(404, "No PDF for this document");

  const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
  const filename = `${(data.title ?? "document").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
