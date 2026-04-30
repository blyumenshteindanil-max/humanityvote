import FingerprintJS from '@fingerprintjs/fingerprintjs';

let fingerprintPromise = null;

// Получаем уникальный ID устройства
// Один и тот же браузер всегда даёт один и тот же ID
export async function getDeviceFingerprint() {
  if (!fingerprintPromise) {
    fingerprintPromise = (async () => {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      return result.visitorId;
    })();
  }
  return fingerprintPromise;
}

// Локальный кеш — чтобы не делать лишних запросов в базу
const VOTED_KEY = 'hv_voted';

export function markAsVoted(questionId, regionId) {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify({
      questionId,
      regionId,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // localStorage может быть недоступен в инкогнито — это ок
  }
}

export function getLocalVote() {
  try {
    const data = localStorage.getItem(VOTED_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}
