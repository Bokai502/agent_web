const items = [
  { label: 'Home', href: '#' },
  { label: 'About', href: '#' },
  { label: 'Contact', href: '#' },
]

export default function V3Page() {
  return (
    <div style={{ minHeight: '100vh', background: '#000', padding: '40px' }}>
      <div style={{ display: 'flex', gap: '28px', color: '#fff' }}>
        {items.map(item => (
          <a key={item.label} href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
            {item.label}
          </a>
        ))}
      </div>
    </div>
  )
}
