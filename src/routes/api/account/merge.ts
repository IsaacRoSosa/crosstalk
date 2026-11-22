import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, HttpError, json } from '../../../lib/http'
import { requireUser } from '../../../lib/session'
import { getAdminClient } from '../../../lib/supabase/server'
import { log } from '../../../lib/log'

// Moves an anonymous user's songs (and AI connection, if the account has none) into the signed-in
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

          const { data: anonNuclei, error: nucleiError } = await admin.from('nuclei').select('id').eq('user_id', anonId)
          if (nucleiError) throw nucleiError

          let mergedTracks = 0
          const nucleusIds = (anonNuclei ?? []).map((n) => n.id)
          if (nucleusIds.length > 0) {
            const { data: links, error: linksError } = await admin
              .from('nucleus_tracks')
              .select('track_id, added_at')
              .in('nucleus_id', nucleusIds)
            if (linksError) throw linksError

            if (links && links.length > 0) {
              const { data: inserted, error: insertError } = await admin
                .from('nucleus_tracks')
                .upsert(
                  links.map((l) => ({ nucleus_id: ctx.nucleus.id, track_id: l.track_id, added_at: l.added_at })),
                  { onConflict: 'nucleus_id,track_id', ignoreDuplicates: true },
                )
                .select('track_id')
              if (insertError) throw insertError
              mergedTracks = inserted?.length ?? 0
            }
          }

          // Keep the guest's AI connection if the account doesn't have one
          const { data: existingAi } = await admin.from('ai_connections').select('user_id').eq('user_id', ctx.userId).maybeSingle()
          if (!existingAi) {
            await admin.from('ai_connections').update({ user_id: ctx.userId }).eq('user_id', anonId)
          }

          // Deleting the auth user cascades to its profile, nuclei, nucleus tracks, chat and AI connection
          const { error: deleteError } = await admin.auth.admin.deleteUser(anonId)
          if (deleteError) log.warn('account', 'could not delete merged anonymous user', { anonId, error: deleteError.message })

          log.info('account', 'merged anonymous account', { into: ctx.userId, mergedTracks })
          return json({ mergedTracks })
        } catch (error) {
          return errorResponse(error, 'Error merging accounts')
        }
      },
    },
  },
})
