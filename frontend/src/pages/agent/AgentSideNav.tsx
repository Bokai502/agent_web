import type { MouseEvent } from 'react'
import { NAV_ITEMS } from './constants'

type AgentSideNavProps = {
  activeNavIndex: number
  onNavSelect: (item: (typeof NAV_ITEMS)[number], index: number, event: MouseEvent<HTMLAnchorElement>) => void
}

export function AgentSideNav({ activeNavIndex, onNavSelect }: AgentSideNavProps) {
  return (
    <nav className="agent-side-nav" aria-label="Agent workspace views">
      {NAV_ITEMS.map((item, index) => (
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
