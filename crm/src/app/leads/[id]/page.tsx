import { LeadDetailClient } from "@/components/lead-detail-client";

export default async function LeadDetailPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  return <LeadDetailClient leadId={id} />;
}
