// Existing delivery tests exercise delivery/queue behavior with valid channel members.
// The dedicated channelMembership suite covers left/kicked/error states separately.
export function memberReply(url) {
  if (!String(url).endsWith('/getChatMember')) return null;
  return new Response(JSON.stringify({ ok: true, result: { status: 'member' } }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
