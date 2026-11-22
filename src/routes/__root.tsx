import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'

import appCss from '../styles.css?url'

// Where the app lives, for link previews (they need absolute URLs)
const SITE_URL = 'https://crosstalkfm.vercel.app'
const TITLE = 'Crosstalk · how much of you is in your library?'
const DESCRIPTION =
  'Crosstalk reads the lyrics of the songs you keep coming back to and builds a nucleus: a first impression of you, before anyone says a word.'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'theme-color', content: '#000000' },
      // Link previews (WhatsApp, iMessage, X, Slack, Discord...)
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Crosstalk' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: `${SITE_URL}/og-image.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Crosstalk: how much of you is in your library?' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: `${SITE_URL}/og-image.png` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),

  shellComponent: RootDocument,
})

// Page views go to Vercel Web Analytics (no cookies). Ids in the path (a nucleus, later a share
// link) are folded into one route so the dashboard groups pages instead of listing every nucleus.
function anonymizePageView(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url)
  // Share tokens are folded too: anyone holding one can open that nucleus
  url.pathname = url.pathname.replace(/\/n\/[^/]+/, '/n/[id]').replace(/^\/s\/[^/]+/, '/s/[token]')
  url.search = ''
  return { ...event, url: url.toString() }
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {/* <TanStackDevtools
          config={{
            position: 'top-left',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        /> */}
        <Analytics beforeSend={anonymizePageView} />
        <Scripts />
      </body>
    </html>
  )
}
