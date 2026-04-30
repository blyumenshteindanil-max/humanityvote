import { ImageResponse } from '@vercel/og';

export const config = {
  runtime: 'edge',
};

const WIDTH = 1200;
const HEIGHT = 630;
const REACT_ELEMENT_TYPE = Symbol.for('react.element');

const FONT_URLS = {
  default:
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf',
  hi:
    'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf',
  zh:
    'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf',
};

const fontCache = new Map();

function h(type, props = {}, ...children) {
  const { key = null, ref = null, ...rest } = props || {};
  const flatChildren = children
    .flat(Infinity)
    .filter((child) => child !== null && child !== undefined && child !== false);

  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref,
    props: {
      ...rest,
      children:
        flatChildren.length === 0
          ? undefined
          : flatChildren.length === 1
            ? flatChildren[0]
            : flatChildren,
    },
    _owner: null,
  };
}

const THEMES = {
  majority: {
    bg: '#031f18',
    panel: '#073326',
    accent: '#34d399',
    soft: 'rgba(52, 211, 153, 0.18)',
    border: 'rgba(52, 211, 153, 0.35)',
  },
  rare: {
    bg: '#241506',
    panel: '#3a240c',
    accent: '#f59e0b',
    soft: 'rgba(245, 158, 11, 0.18)',
    border: 'rgba(245, 158, 11, 0.38)',
  },
  early: {
    bg: '#041a2a',
    panel: '#082f49',
    accent: '#38bdf8',
    soft: 'rgba(56, 189, 248, 0.18)',
    border: 'rgba(56, 189, 248, 0.38)',
  },
};

const QUESTION_ORDER = ['air', 'water', 'food', 'climate', 'health', 'peace', 'inequality', 'ai'];

const QUESTION_ALIASES = {
  air: 'air',
  air_quality: 'air',
  'air-quality': 'air',
  water: 'water',
  fresh_water: 'water',
  freshwater: 'water',
  'fresh-water': 'water',
  food: 'food',
  climate: 'climate',
  health: 'health',
  peace: 'peace',
  security: 'peace',
  war: 'peace',
  inequality: 'inequality',
  ai: 'ai',
  ai_control: 'ai',
  'ai-control': 'ai',
  artificial_intelligence: 'ai',
};

const REGION_ORDER = ['eu', 'as', 'na', 'sa', 'af', 'oc'];

const REGION_ALIASES = {
  eu: 'eu',
  europe: 'eu',
  as: 'as',
  asia: 'as',
  na: 'na',
  north_america: 'na',
  'north-america': 'na',
  sa: 'sa',
  south_america: 'sa',
  'south-america': 'sa',
  af: 'af',
  africa: 'af',
  oc: 'oc',
  oceania: 'oc',
};

const QUESTIONS = {
  air: {
    en: 'Air quality',
    ru: 'Качество воздуха',
    de: 'Luftqualität',
    es: 'Calidad del aire',
    pt: 'Qualidade do ar',
    zh: '空气质量',
    hi: 'वायु गुणवत्ता',
  },
  water: {
    en: 'Fresh water',
    ru: 'Пресная вода',
    de: 'Süßwasser',
    es: 'Agua dulce',
    pt: 'Água doce',
    zh: '淡水',
    hi: 'मीठा पानी',
  },
  food: {
    en: 'Food supply',
    ru: 'Продовольствие',
    de: 'Nahrung',
    es: 'Alimentos',
    pt: 'Alimentos',
    zh: '粮食',
    hi: 'खाद्य सुरक्षा',
  },
  climate: {
    en: 'Climate',
    ru: 'Климат',
    de: 'Klima',
    es: 'Clima',
    pt: 'Clima',
    zh: '气候',
    hi: 'जलवायु',
  },
  health: {
    en: 'Health',
    ru: 'Здоровье',
    de: 'Gesundheit',
    es: 'Salud',
    pt: 'Saúde',
    zh: '健康',
    hi: 'स्वास्थ्य',
  },
  peace: {
    en: 'Peace & security',
    ru: 'Мир и безопасность',
    de: 'Frieden & Sicherheit',
    es: 'Paz y seguridad',
    pt: 'Paz e segurança',
    zh: '和平与安全',
    hi: 'शांति और सुरक्षा',
  },
  inequality: {
    en: 'Inequality',
    ru: 'Неравенство',
    de: 'Ungleichheit',
    es: 'Desigualdad',
    pt: 'Desigualdade',
    zh: '不平等',
    hi: 'असमानता',
  },
  ai: {
    en: 'AI control',
    ru: 'Контроль над ИИ',
    de: 'KI-Kontrolle',
    es: 'Control de IA',
    pt: 'Controle da IA',
    zh: '人工智能控制',
    hi: 'एआई नियंत्रण',
  },
};

const REGIONS = {
  eu: { en: 'Europe', ru: 'Европа', de: 'Europa', es: 'Europa', pt: 'Europa', zh: '欧洲', hi: 'यूरोप' },
  as: { en: 'Asia', ru: 'Азия', de: 'Asien', es: 'Asia', pt: 'Ásia', zh: '亚洲', hi: 'एशिया' },
  na: { en: 'North America', ru: 'Северная Америка', de: 'Nordamerika', es: 'América del Norte', pt: 'América do Norte', zh: '北美洲', hi: 'उत्तर अमेरिका' },
  sa: { en: 'South America', ru: 'Южная Америка', de: 'Südamerika', es: 'América del Sur', pt: 'América do Sul', zh: '南美洲', hi: 'दक्षिण अमेरिका' },
  af: { en: 'Africa', ru: 'Африка', de: 'Afrika', es: 'África', pt: 'África', zh: '非洲', hi: 'अफ्रीका' },
  oc: { en: 'Oceania', ru: 'Океания', de: 'Ozeanien', es: 'Oceanía', pt: 'Oceania', zh: '大洋洲', hi: 'ओशिआनिया' },
};

const COPY = {
  en: { votedFor: 'I voted for', agree: 'agree in', foot: 'One anonymous vote. One time. Forever.', states: { majority: 'Majority signal', rare: 'Rare signal', early: 'Early signal' } },
  ru: { votedFor: 'Я выбрал(а)', agree: 'согласны в регионе', foot: 'Один анонимный голос. Один раз. Навсегда.', states: { majority: 'Сильный сигнал региона', rare: 'Редкий выбор', early: 'Первые голоса' } },
  de: { votedFor: 'Ich stimmte für', agree: 'stimmen zu in', foot: 'Eine anonyme Stimme. Einmal. Für immer.', states: { majority: 'Mehrheitssignal', rare: 'Seltenes Signal', early: 'Frühes Signal' } },
  es: { votedFor: 'Voté por', agree: 'coinciden en', foot: 'Un voto anónimo. Una vez. Para siempre.', states: { majority: 'Señal mayoritaria', rare: 'Señal rara', early: 'Señal temprana' } },
  pt: { votedFor: 'Votei em', agree: 'concordam em', foot: 'Um voto anônimo. Uma vez. Para sempre.', states: { majority: 'Sinal majoritário', rare: 'Sinal raro', early: 'Sinal inicial' } },
  zh: { votedFor: '我投给了', agree: '在该地区认同', foot: '一次匿名投票。只投一次。永久记录。', states: { majority: '多数信号', rare: '少数信号', early: '早期信号' } },
  hi: { votedFor: 'मैंने चुना', agree: 'इस क्षेत्र में सहमत', foot: 'एक गुमनाम वोट। एक बार। हमेशा के लिए।', states: { majority: 'बहुमत संकेत', rare: 'दुर्लभ संकेत', early: 'आरंभिक संकेत' } },
};

function normalizeLang(value) {
  return ['en', 'ru', 'de', 'es', 'pt', 'zh', 'hi'].includes(value) ? value : 'en';
}

function normalizeQuestion(value) {
  const raw = String(value || 'climate').trim().toLowerCase();

  if (/^[1-8]$/.test(raw)) {
    return QUESTION_ORDER[Number(raw) - 1];
  }

  return QUESTION_ALIASES[raw] || 'climate';
}

function normalizeRegion(value) {
  const raw = String(value || 'eu').trim().toLowerCase();

  if (/^[1-6]$/.test(raw)) {
    return REGION_ORDER[Number(raw) - 1];
  }

  return REGION_ALIASES[raw] || 'eu';
}

function parsePct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function parseRank(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return null;
  return Math.floor(number);
}

function formatPct(value, rank) {
  if (rank !== null) return `#${rank}`;
  if (value === null) return 'NEW';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace('.0', '');
}

function resolveState(searchParams, pct) {
  const explicit = String(searchParams.get('state') || searchParams.get('status') || '').toLowerCase();

  if (['majority', 'rare', 'early'].includes(explicit)) {
    return explicit;
  }

  const total = Number(searchParams.get('total') || searchParams.get('votes') || searchParams.get('n'));

  if (Number.isFinite(total) && total > 0 && total < 25) {
    return 'early';
  }

  if (pct === null) return 'early';
  if (pct < 10) return 'rare';

  return 'majority';
}

async function loadFont(lang) {
  const url = lang === 'zh' ? FONT_URLS.zh : lang === 'hi' ? FONT_URLS.hi : FONT_URLS.default;

  if (!fontCache.has(url)) {
    fontCache.set(
      url,
      fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error(`Font request failed: ${response.status}`);
        }

        return response.arrayBuffer();
      })
    );
  }

  return fontCache.get(url);
}

function textFor(map, lang) {
  return map[lang] || map.en;
}

function renderCard({ lang, question, region, pct, rank, state }) {
  const theme = THEMES[state];
  const copy = COPY[lang] || COPY.en;
  const questionText = textFor(QUESTIONS[question], lang);
  const regionText = textFor(REGIONS[region], lang);
  const statText = formatPct(pct, rank);
  const isPercent = pct !== null && rank === null;

  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: theme.bg,
        color: '#ecfdf5',
        fontFamily: 'HVFont',
        padding: '56px 64px',
        boxSizing: 'border-box',
      },
    },
    h('div', {
      style: {
        position: 'absolute',
        width: 520,
        height: 520,
        borderRadius: 999,
        border: `2px solid ${theme.border}`,
        right: -120,
        top: -160,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        width: 360,
        height: 360,
        borderRadius: 999,
        backgroundColor: theme.soft,
        right: 80,
        bottom: -180,
      },
    }),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 640,
          height: '100%',
          zIndex: 1,
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('div', {
          style: {
            fontSize: 24,
            lineHeight: 1,
            color: theme.accent,
            letterSpacing: 0,
          },
        }, 'HumanityVote'),
        h('div', {
          style: {
            marginTop: 14,
            fontSize: 30,
            lineHeight: 1.25,
            color: 'rgba(236, 253, 245, 0.72)',
          },
        }, copy.votedFor)
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('div', {
          style: {
            fontSize: questionText.length > 18 ? 68 : 86,
            lineHeight: 1.02,
            color: '#ffffff',
          },
        }, questionText),
        h('div', {
          style: {
            marginTop: 28,
            width: 148,
            height: 8,
            borderRadius: 999,
            backgroundColor: theme.accent,
          },
        })
      ),
      h('div', {
        style: {
          fontSize: 26,
          lineHeight: 1.3,
          color: 'rgba(236, 253, 245, 0.66)',
        },
      }, copy.foot)
    ),
    h(
      'div',
      {
        style: {
          marginLeft: 'auto',
          width: 390,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1,
        },
      },
      h('div', {
        style: {
          padding: '12px 22px',
          borderRadius: 999,
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.soft,
          color: theme.accent,
          fontSize: 24,
          lineHeight: 1,
        },
      }, copy.states[state]),
      h('div', {
        style: {
          marginTop: 40,
          fontSize: isPercent ? 168 : 118,
          lineHeight: 0.95,
          color: theme.accent,
        },
      }, isPercent ? `${statText}%` : statText),
      h('div', {
        style: {
          marginTop: 30,
          maxWidth: 340,
          textAlign: 'center',
          fontSize: 30,
          lineHeight: 1.25,
          color: 'rgba(236, 253, 245, 0.78)',
        },
      }, `${copy.agree}: ${regionText}`),
      h('div', {
        style: {
          marginTop: 44,
          fontSize: 24,
          lineHeight: 1,
          color: 'rgba(236, 253, 245, 0.48)',
        },
      }, 'humanityvote.org')
    )
  );
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const lang = normalizeLang(url.searchParams.get('lang'));
    const question = normalizeQuestion(url.searchParams.get('q'));
    const region = normalizeRegion(url.searchParams.get('r'));
    const pct = parsePct(url.searchParams.get('pct'));
    const rank = parseRank(url.searchParams.get('rank'));
    const state = resolveState(url.searchParams, pct);
    const fontData = await loadFont(lang);

    return new ImageResponse(renderCard({ lang, question, region, pct, rank, state }), {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        {
          name: 'HVFont',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    return new Response(`OG render error: ${error?.message || String(error)}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
}
