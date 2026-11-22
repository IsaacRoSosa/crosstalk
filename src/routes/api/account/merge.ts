import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { getAdminClient } from '../../../lib/supabase/server'
import { log } from '../../../lib/log'

// Moves an anonymous user's nuclei (and AI connection, if the account has none) into the signed-in
// account, then deletes the anonymous user. Used when someone builds a galaxy as a guest and then
// signs in with a Google account that already had a Crosstalk account.
export const Route = createFileRoute('/api/account/merge')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await requireUser(request)
          const { anonymousAccessToken } = await request.json()
          if (typeof anonymousAccessToken !== 'string' || !anonymousAccessToken) {
            throw new HttpError(400, 'Missing anonymous session')
          }

          const admin = getAdminClient()

          // Proves the caller owned the anonymous session; only anonymous users can be merged away
          const { data: anon, error: anonError } = await admin.auth.getUser(anonymousAccessToken)
          if (anonError || !anon.user) {
            throw new HttpError(400, 'Your guest session expired, so its songs could not be moved.')
          }
          if (!anon.user.is_anonymous || anon.user.id === ctx.userId) {
            throw new HttpError(400, 'Only a guest session can be merged into your account.')
          }
          const anonId = anon.user.id

          // Hand the guest's nuclei that have songs over to the account, chat included.
          // Done with the admin client, so it isn't subject to the per-account nucleus limit.
          const { data: anonNuclei, error: nucleiError } = await admin
            .from('nuclei')
            .select('id, nucleus_tracks(count)')
            .eq('user_id', anonId)
          if (nucleiError) throw nucleiError

          const withSongs = (anonNuclei ?? []).filter((n) => (n.nucleus_tracks?.[0]?.count ?? 0) > 0)
          const mergedTracks = withSongs.reduce((sum, n) => sum + (n.nucleus_tracks?.[0]?.count ?? 0), 0)
          if (withSongs.length > 0) {
            const { error: moveError } = await admin
              .from('nuclei')
              .update({ user_id: ctx.userId })
              .in('id', withSongs.map((n) => n.id))
            if (moveError) throw moveError
          }

          // Keep the guest's AI connection if the account doesn't have one
          const { data: existingAi } = await admin.from('ai_connections').select('user_id').eq('user_id', ctx.userId).maybeSingle()
          if (!existingAi) {
            await admin.from('ai_connections').update({ user_id: ctx.userId }).eq('user_id', anonId)
          }

          // Deleting the auth user cascades to its profile, nuclei, nucleus tracks, chat and AI connection
          const { error: deleteError } = await admin.auth.admin.deleteUser(anonId)
          if (deleteError) log.warn('account', 'could not delete merged anonymous user', { anonId, error: deleteError.message })

          log.info('account', 'merged anonymous account', { into: ctx.userId, movedNuclei: withSongs.length, mergedTracks })
          return json({ mergedTracks, movedNuclei: withSongs.length })
        } catch (error) {
          return errorResponse(error, 'Error merging accounts')
        }
      },
    },
  },
})
