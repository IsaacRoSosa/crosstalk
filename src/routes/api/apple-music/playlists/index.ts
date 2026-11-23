import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, json } from '../../../../lib/http'
import { requireUser } from '../../../../lib/session'
import { fetchLibraryPlaylists } from '../../../../lib/apple-music'
import { withAppleMusicUser } from '../../../../lib/apple-music-connection'

// The person's library playlists, Replay and the like first
export const Route = createFileRoute('/api/apple-music/playlists/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const playlists = await withAppleMusicUser(ctx, request, (user) => fetchLibraryPlaylists(user.userToken))
          return json({ playlists })
        } catch (error) {
          return errorResponse(error, 'Error listing Apple Music playlists')
        }
      },
    },
  },
})
