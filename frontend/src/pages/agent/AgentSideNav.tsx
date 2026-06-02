import type { MouseEvent } from 'react'
import { NAV_ITEMS } from './constants'

type AgentSideNavProps = {
  activeNavIndex: number
  navItems?: typeof NAV_ITEMS
  onNavSelect: (item: (typeof NAV_ITEMS)[number], index: number, event: MouseEvent<HTMLAnchorElement>) => void
}

export function AgentSideNav({ activeNavIndex, navItems = NAV_ITEMS, onNavSelect }: AgentSideNavProps) {
  return (
    <nav className="agent-side-nav" aria-label="Agent workspace views">
      {navItems.map((item, index) => (
        <a
          key={item.href}
          className={activeNavIndex === index ? 'active' : undefined}
          href={item.href}
          onClick={event => onNavSelect(item, index, event)}
        >
          <span>{item.label}</span>
          <small>{item.meta}</small>
        </a>
      ))}
    </nav>
  )
}
