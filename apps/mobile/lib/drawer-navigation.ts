export function drawerNavigationMethod(href: string): 'push' | 'replace' {
  return /^\/[^/]+\/posts$/.test(href) ? 'replace' : 'push';
}
