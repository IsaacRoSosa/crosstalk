import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../../lib/http'
import { requireUser } from '../../../../lib/session'
import { fetchLibraryPlaylistLines } from '../../../../lib/apple-music'
import { withAppleMusicUser } from '../../../../lib/apple-music-connection'

// One playlist's songs as import input (one line per song), for /api/tracks/import
export const Route = createFileRoute('/api/apple-music/playlists/$playlistId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const ctx = await requireUser(request)
          if (!/^[A-Za-z0-9._-]{1,100}$/.test(params.playlistId)) throw new HttpError(400, 'Unknown playlist.')
          const lines = await withAppleMusicUser(ctx, request, (user) =>
            fetchLibraryPlaylistLines(user.userToken, params.playlistId, user.storefront),
          )
          return json({ input: lines.join('\n'), count: lines.length })
        } catch (error) {
          return errorResponse(error, 'Error reading Apple Music playlist')
        }
      },
    },
  },
})
