import { useState, useEffect, useMemo } from 'react';

/**
 * ResultCard
 * ------------------------------------------------------------------
 * Shows a personal share card after the user has voted, with three
 * actions: native share, copy link, download PNG.
 *
 * Props:
 *  - questionId : string (e.g. "ai", "climate", "water")
 *  - regionId   : 'eu' | 'as' | 'na' | 'sa' | 'af' | 'oc'
 *  - regionStats: { questionId: count }  — vote counts in user's region
 *  - regionTotal: number                  — total votes in user's region
 *  - lang       : 'en' | 'ru' | 'de' | ... (must match og.jsx COPY keys)
 *  - t          : translation function (key) => string  — from i18n.js
 *  - siteUrl    : 'https://humanityvote.org'
 */
export default function ResultCard({
  questionId,
  regionId,
  regionStats = {},
  regionTotal = 0,
  lang = 'en',
  t,
  siteUrl,
}) {
  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('idle'); // idle | loading | done | error
  const translate = typeof t === 'function' ? t : (key) => key;
  const baseUrl = siteUrl || 'https://humanityvote.org';

  // ── Decide card state: early / rare / majority ──
  const { state, pct, rank } = useMemo(() => {
    const myCount = regionStats[questionId] || 0;
    if (regionTotal < 50) {
      return { state: 'early', pct: null, rank: myCount };
    }
    const percentage = Math.round((myCount / regionTotal) * 100);
    if (percentage < 15) return { state: 'rare', pct: percentage, rank: null };
    return { state: 'majority', pct: percentage, rank: null };
  }, [questionId, regionStats, regionTotal]);

  // ── Build the OG image URL ──
  const ogUrl = useMemo(() => {
    const params = new URLSearchParams({ q: questionId, r: regionId, lang, state });
    if (state === 'early') params.set('rank', String(rank));
    else params.set('pct', String(pct));
    return `${baseUrl}/api/og?${params.toString()}`;
  }, [questionId, regionId, lang, state, pct, rank, baseUrl]);

  // Direct link to the site (this is what people share)
  const shareUrl = `${baseUrl}/?utm_source=share&utm_medium=card&q=${questionId}`;

  // ── Actions ──
  const getImageFile = async () => {
    const res = await fetch(ogUrl);
    const blob = await res.blob();
    return new File([blob], `humanityvote-${questionId}.png`, { type: 'image/png' });
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        try {
          const imageFile = await getImageFile();
          if (navigator.canShare?.({ files: [imageFile] })) {
            await navigator.share({
              title: translate('share_title'),
              text: translate('share_text'),
              files: [imageFile],
            });
            return;
          }
        } catch (_) {
          /* fall back to URL sharing */
        }

        await navigator.share({
          title: translate('share_title'),
          text: translate('share_text'),
          url: shareUrl,
        });
        return;
      }
      await handleCopy();
    } catch (_) {
      /* user cancelled */
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleDownload = async () => {
    setDownloadStatus('loading');
    try {
      const imageFile = await getImageFile();
      const url = URL.createObjectURL(imageFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = imageFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadStatus('done');
      setTimeout(() => setDownloadStatus('idle'), 2000);
    } catch (_) {
      setDownloadStatus('error');
      setTimeout(() => setDownloadStatus('idle'), 2000);
    }
  };

  // ── Styles ──
  const wrap = {
    width: '100%',
    maxWidth: 560,
    margin: '32px auto 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  };
  const previewWrap = {
    width: '100%',
    aspectRatio: '1200 / 630',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid rgba(0,220,140,0.15)',
    background: '#020805',
    boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,255,157,0.05)',
  };
  const previewImg = { width: '100%', height: '100%', display: 'block', objectFit: 'cover' };
  const buttonRow = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  };
  const btnBase = {
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid rgba(0,220,140,0.25)',
    background: 'rgba(0,255,157,0.04)',
    color: '#e0ffe8',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 12,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 200ms ease',
    fontWeight: 500,
  };
  const btnPrimary = {
    ...btnBase,
    background: '#00ff9d',
    color: '#020805',
    border: '1px solid #00ff9d',
    fontWeight: 700,
  };
  const helper = {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    color: 'rgba(220,255,235,0.5)',
    textAlign: 'center',
    marginTop: 4,
  };

  return (
    <div style={wrap}>
      <div style={previewWrap}>
        <img
          src={ogUrl}
          alt={translate('share_alt')}
          style={previewImg}
          loading="eager"
        />
      </div>

      <div style={buttonRow}>
        <button style={btnPrimary} onClick={handleShare}>
          {translate('share_button')}
        </button>
        <button style={btnBase} onClick={handleCopy}>
          {copied ? translate('copied') : translate('copy_link')}
        </button>
        <button style={btnBase} onClick={handleDownload}>
          {downloadStatus === 'loading' ? '…' :
           downloadStatus === 'done'    ? '✓' :
           downloadStatus === 'error'   ? '!' :
           translate('download_image')}
        </button>
      </div>

      <div style={helper}>{translate('share_helper')}</div>
    </div>
  );
}
