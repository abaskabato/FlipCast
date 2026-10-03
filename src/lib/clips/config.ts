/**
 * Whether AI clip finding is switched on for this deployment.
 *
 * Every Vercel deployment has an OIDC token, so its presence says nothing
 * about whether AI Gateway is enabled for the team. Clip finding is offered
 * only when it is turned on explicitly, or an AI Gateway API key is set.
 *
 * Node only.
 */
export function clipFindingEnabled(): boolean {
  return process.env.CLIP_FINDING_ENABLED === '1' || Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}
