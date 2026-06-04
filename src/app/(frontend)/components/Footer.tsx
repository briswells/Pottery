type Hours = { days?: string | null; time?: string | null }

export function Footer({ phone, email, addressLine, hours }: {
  phone?: string | null; email?: string | null; addressLine?: string | null; hours?: Hours[] | null
}) {
  return (
    <footer className="pp-footer">
      <div className="pp-container">
        {addressLine && <div>{addressLine}</div>}
        {phone && <div>{phone}</div>}
        {email && <div><a href={`mailto:${email}`}>{email}</a></div>}
        {hours?.length ? (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
            {hours.map((h, i) => <li key={i}>{h.days}: {h.time}</li>)}
          </ul>
        ) : null}
      </div>
    </footer>
  )
}
