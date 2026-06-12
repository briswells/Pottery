import Link from 'next/link'

// A members-only shortcut into the People list: filters to people who have a plan.
export default function MembersNavLink() {
  return (
    <Link href="/admin/collections/people?where[plan][exists]=true" className="nav__link">
      Members
    </Link>
  )
}
