import { NavLink, Outlet } from 'react-router-dom'

import { AUTHOR_NAME, AUTHOR_URL, LICENSE_URL, REPOSITORY_URL } from '@/lib/seo/site'

/** Shell provides the shared navigation and decorative chrome around route content. */
export function Shell() {
  return (
    <div className="shell">
      <div aria-hidden="true" className="shell-ornament shell-ornament--aurora" />
      <div aria-hidden="true" className="shell-ornament shell-ornament--grid" />
      <header className="topbar">
        <NavLink aria-label="Xdrop" className="brand" to="/">
          <img
            alt=""
            aria-hidden="true"
            className="brand-icon"
            height="40"
            src="/brand-symbol.svg"
            width="40"
          />
          <span className="brand-copy">
            <span className="brand-mark">Xdrop</span>
            <span className="brand-note">Browser-encrypted transfer</span>
          </span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/">Send</NavLink>
          <NavLink to="/transfers">Transfers</NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__copy">
          <p>
            Developed by{' '}
            <a className="inline-link" href={AUTHOR_URL} rel="noreferrer" target="_blank">
              {AUTHOR_NAME}
            </a>{' '}
            and released under the GNU Affero General Public License v3.0 only.{' '}
            <a className="inline-link" href={LICENSE_URL} rel="noreferrer" target="_blank">
              View the license
            </a>{' '}
            or find more information and source code on{' '}
            <a className="inline-link" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
              GitHub
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  )
}
