export const SHOPIFY_LINK_PATH = '/shopify/link'

/**
 * Shopify App Store merchants must stay in the connector's free, isolated
 * account-linking journey. Keep this check small and shared between the login
 * page, OAuth callback, and client login form so none of those surfaces can
 * accidentally route a Shopify install through Nexez plan onboarding.
 */
export function isShopifyLinkPath(path: string | null | undefined): boolean {
  if (!path) return false
  return path === SHOPIFY_LINK_PATH
    || path.startsWith(`${SHOPIFY_LINK_PATH}?`)
    || path.startsWith(`${SHOPIFY_LINK_PATH}#`)
}
