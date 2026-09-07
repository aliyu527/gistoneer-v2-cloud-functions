import {onCall} from 'firebase-functions/v2/https';
import {db} from '../../admin';
import {resolveRange, type DashboardRangeInput} from './dashboardRange';
import {requireActiveAdmin} from './requireActiveAdmin';

interface MusicAnalyticsResponse {
  totalSounds: number;
  newSounds: number;
  publicSounds: number;
  totalPlaylists: number;
  newPlaylists: number;
}

/**
 * Deliberately does not include "plays"/"most used"/"trending" — sounds
 * have no play-count field anywhere (playback is a client-side preview
 * only), and per-sound usageCount (Module 06's adminGetSoundDetail) is
 * computed on demand via one count() query for that single sound; ranking
 * "most used" across every sound would mean running that query once per
 * sound, which is exactly the unbounded-scan pattern the spec forbids.
 * Disclosed as a gap in the final report, not faked here.
 */
export const getMusicAnalytics = onCall<DashboardRangeInput, Promise<MusicAnalyticsResponse>>({cors: true, region: 'us-central1'}, async (request) => {
  await requireActiveAdmin(request, 'analytics.read');

  const {start, end} = resolveRange(request.data ?? {});

  const [totalSoundsSnap, newSoundsSnap, publicSoundsSnap, totalPlaylistsSnap, newPlaylistsSnap] = await Promise.all([
    db.collection('sounds').count().get(),
    db.collection('sounds').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
    db.collection('sounds').where('visibility', '==', 'public').count().get(),
    db.collection('playlists').count().get(),
    db.collection('playlists').where('createdAt', '>=', start).where('createdAt', '<=', end).count().get(),
  ]);

  return {
    totalSounds: totalSoundsSnap.data().count,
    newSounds: newSoundsSnap.data().count,
    publicSounds: publicSoundsSnap.data().count,
    totalPlaylists: totalPlaylistsSnap.data().count,
    newPlaylists: newPlaylistsSnap.data().count,
  };
});
