import type { VocabularyBand } from '../core/types.js';

/**
 * C1 lexical range. Twelve frequency-banded word sets, top 500 through
 * top 20,000. Ordered by corpus frequency band; each set is a seed set that
 * the recognition and production passes draw from deterministically.
 */
export const VOCAB_BANDS: Record<VocabularyBand, { label: string; freq_range: string; words: string[] }> = {
  V1: {
    label: 'TOP 500',
    freq_range: '1-500',
    words: [
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on',
      'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we',
      'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
      'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    ],
  },
  V2: {
    label: '500-1,000',
    freq_range: '501-1000',
    words: [
      'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people',
      'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
      'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
      'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
      'any', 'these', 'give', 'day', 'most', 'us',
    ],
  },
  V3: {
    label: '1,000-2,000',
    freq_range: '1001-2000',
    words: [
      'man', 'find', 'here', 'thing', 'tell', 'very', 'great', 'little', 'world', 'still',
      'own', 'under', 'last', 'right', 'move', 'life', 'need', 'hand', 'old', 'place', 'part',
      'child', 'few', 'while', 'might', 'close', 'open', 'begin', 'always', 'those', 'both',
      'paper', 'together', 'often', 'run', 'important', 'until', 'children', 'side', 'car',
      'night', 'white', 'sea', 'grow', 'took', 'river', 'four', 'carry', 'state', 'once',
      'book', 'hear', 'stop', 'without', 'second', 'later', 'idea', 'enough', 'face', 'watch',
    ],
  },
  V4: {
    label: '2,000-4,000',
    freq_range: '2001-4000',
    words: [
      'area', 'age', 'agree', 'allow', 'answer', 'art', 'arrive', 'attention', 'base',
      'behavior', 'believe', 'black', 'blue', 'board', 'body', 'break', 'brother', 'build',
      'business', 'camera', 'capital', 'career', 'central', 'chance', 'character', 'choice',
      'class', 'clear', 'college', 'color', 'common', 'community', 'company', 'compare',
      'computer', 'concern', 'condition', 'control', 'cost', 'count', 'court', 'cover',
      'create', 'crime', 'culture', 'current', 'customer', 'data', 'daughter', 'deal',
      'death', 'decade', 'decide', 'deep', 'defense', 'degree', 'design', 'detail',
      'determine', 'development', 'difference', 'different', 'difficult', 'dinner',
    ],
  },
  V5: {
    label: '4,000-7,000',
    freq_range: '4001-7000',
    words: [
      'discover', 'discuss', 'doctor', 'door', 'draw', 'dream', 'drive', 'early', 'earth',
      'edge', 'effect', 'effort', 'eight', 'either', 'election', 'employee', 'energy',
      'enjoy', 'enter', 'environment', 'especially', 'establish', 'evening', 'event',
      'evidence', 'exactly', 'executive', 'exist', 'expect', 'experience', 'expert',
      'explain', 'factor', 'federal', 'figure', 'financial', 'fine', 'finish', 'firm',
      'floor', 'focus', 'follow', 'force', 'foreign', 'forget', 'former', 'forward',
      'friend', 'front', 'fund', 'future', 'garden', 'general', 'generation', 'government',
      'growth', 'guess', 'happy', 'health', 'heavy', 'history', 'hospital', 'hotel',
      'however', 'huge', 'human', 'husband', 'identify', 'image', 'imagine', 'impact',
    ],
  },
  V6: {
    label: '7,000-10,000',
    freq_range: '7001-10000',
    words: [
      'improve', 'include', 'increase', 'indicate', 'individual', 'industry', 'information',
      'inside', 'instead', 'institution', 'interest', 'international', 'interview',
      'investment', 'involve', 'issue', 'item', 'join', 'keep', 'knowledge', 'language',
      'large', 'leader', 'learn', 'legal', 'level', 'likely', 'listen', 'local', 'machine',
      'magazine', 'maintain', 'major', 'majority', 'manage', 'material', 'measure', 'medical',
      'meeting', 'member', 'memory', 'mention', 'method', 'military', 'million', 'minute',
      'mission', 'modern', 'moment', 'movement', 'music', 'national', 'natural', 'necessary',
      'network', 'newspaper', 'north', 'nothing', 'notice', 'number', 'occur', 'offer',
      'office', 'officer', 'official', 'often', 'opportunity', 'option', 'organization',
      'outside',
    ],
  },
  V7: {
    label: '10,000-14,000',
    freq_range: '10001-14000',
    words: [
      'owner', 'participate', 'particular', 'partner', 'pattern', 'patient', 'perform',
      'performance', 'perhaps', 'period', 'personal', 'physical', 'picture', 'policy',
      'political', 'popular', 'population', 'position', 'positive', 'possible', 'practice',
      'prepare', 'present', 'president', 'pressure', 'prevent', 'private', 'probably',
      'process', 'produce', 'product', 'production', 'professional', 'professor', 'program',
      'project', 'property', 'protect', 'prove', 'provide', 'public', 'purpose', 'quality',
      'question', 'quickly', 'radio', 'raise', 'range', 'rather', 'reach', 'ready',
      'realize', 'reason', 'receive', 'recent', 'recognize', 'record', 'reduce', 'reflect',
      'region', 'relate', 'relationship', 'religious', 'remain', 'remember', 'remove',
      'report', 'represent', 'require', 'research', 'resource', 'respond', 'response',
      'responsibility', 'return', 'reveal',
    ],
  },
  V8: {
    label: '14,000-20,000',
    freq_range: '14001-20000',
    words: [
      'senior', 'series', 'serious', 'serve', 'service', 'several', 'sexual', 'share',
      'shelter', 'significant', 'similar', 'simple', 'simply', 'social', 'society', 'soldier',
      'solution', 'somebody', 'someone', 'something', 'sometimes', 'source', 'southern',
      'special', 'specific', 'speech', 'spend', 'sport', 'spring', 'standard', 'statement',
      'station', 'strategy', 'structure', 'student', 'study', 'style', 'subject', 'success',
      'successful', 'suddenly', 'suffer', 'suggest', 'summer', 'support', 'surface', 'system',
      'target', 'teacher', 'technical', 'technique', 'technology', 'television', 'tension',
      'theory', 'therefore', 'themselves', 'thousand', 'threat', 'through', 'throughout',
      'toward', 'traditional', 'traffic', 'training', 'transfer', 'transport', 'travel',
      'treat', 'treatment', 'trend', 'trouble', 'truth', 'typical', 'unique', 'unite',
      'university', 'violence', 'visitor', 'volume', 'weather', 'weight', 'western', 'whether',
      'whole', 'window', 'without',
    ],
  },
  V9: {
    label: '20,000-30,000',
    freq_range: '20001-30000',
    words: [
      'accuracy', 'adjust', 'admire', 'admit', 'adopt', 'advantage', 'advise', 'affect',
      'afford', 'agenda', 'aggression', 'alarm', 'alter', 'amount', 'analogy', 'ancient',
      'annual', 'anxiety', 'apparent', 'appeal', 'approach', 'approve', 'approximate',
      'arrange', 'arrival', 'assess', 'assign', 'assume', 'assure', 'attach', 'attempt',
      'attitude', 'attract', 'author', 'autonomy', 'awareness', 'barrier', 'boundary',
      'capable', 'capacity', 'category', 'cease', 'challenge', 'circumstance', 'cite',
      'civil', 'clarify', 'classify', 'comment', 'commit', 'compensate', 'complex',
      'component', 'comprehensive', 'comprise', 'conceive', 'concept', 'conclude',
      'conduct', 'confident', 'confirm', 'conflict', 'conform', 'confront', 'consequence',
      'conserve', 'consider', 'consist', 'constant', 'constitute', 'constrain', 'consult',
    ],
  },
  V10: {
    label: '30,000-50,000',
    freq_range: '30001-50000',
    words: [
      'consume', 'contemporary', 'contradict', 'contribute', 'controversy', 'convention',
      'convert', 'convey', 'cooperate', 'corporate', 'correspond', 'credibility', 'criteria',
      'critical', 'cumulative', 'currency', 'curriculum', 'decline', 'dedicate', 'deficiency',
      'definite', 'deliberate', 'democracy', 'demonstrate', 'denote', 'deprive', 'derive',
      'deteriorate', 'determine', 'devise', 'differentiate', 'diminish', 'discipline',
      'discourse', 'displace', 'dispose', 'dissolve', 'distinguish', 'distort', 'diverse',
      'domestic', 'dominate', 'elaborate', 'eliminate', 'emerge', 'emphasis', 'empirical',
      'enhance', 'enormous', 'ensure', 'equivalent', 'essential', 'establish', 'evaluate',
      'evident', 'evoke', 'exaggerate', 'exceed', 'exclusive', 'exempt', 'exert', 'exhaust',
      'exhibit', 'expand', 'explicit', 'exploit', 'extract', 'facilitate', 'fatigue', 'finite',
      'fluctuate',
    ],
  },
  V11: {
    label: '50,000-80,000',
    freq_range: '50001-80000',
    words: [
      'formulate', 'fundamental', 'generate', 'hypothesis', 'illuminate', 'implement',
      'implicit', 'incentive', 'incline', 'incorporate', 'indispensable', 'inevitable',
      'inference', 'inherent', 'inhibit', 'initiate', 'innovate', 'integral', 'integrate',
      'integrity', 'intensity', 'intervene', 'intrinsic', 'intuition', 'invoke', 'jeopardy',
      'latent', 'leverage', 'magnitude', 'manipulate', 'margin', 'mediate', 'metaphor',
      'mitigate', 'modify', 'negligible', 'notion', 'nurture', 'objective', 'obsolete',
      'offset', 'optimal', 'paradigm', 'parallel', 'parameter', 'paramount', 'parse',
      'perceive', 'persistent', 'phenomenon', 'plausible', 'ponder', 'practical', 'precede',
      'precedent', 'preliminary', 'premise', 'presume', 'prevail', 'principle', 'profound',
      'prohibit', 'prominent', 'propagate', 'prudent', 'quantify', 'radical', 'reciprocal',
      'redundant', 'reinforce', 'reluctant', 'render', 'resilience', 'retain', 'retrieve',
      'rigorous', 'simultaneous',
    ],
  },
  V12: {
    label: '80,000-200,000',
    freq_range: '80001-200000',
    words: [
      'skeptical', 'spontaneous', 'stability', 'stimulus', 'subordinate', 'subsidy',
      'subtle', 'sufficient', 'superficial', 'supplement', 'suppress', 'surveillance',
      'susceptible', 'synthesis', 'tangible', 'tedious', 'temporal', 'tentative', 'terminate',
      'threshold', 'transparent', 'trajectory', 'trivial', 'ubiquitous', 'unanimous',
      'unprecedented', 'utilize', 'vacant', 'validate', 'vanish', 'verbatim', 'viable',
      'vibrant', 'vicinity', 'vindicate', 'virtue', 'volatile', 'warrant', 'wary', 'wield',
      'withhold', 'zealous', 'aberration', 'abstain', 'accolade', 'acrimony', 'admonish',
      'adverse', 'aesthetic', 'alleviate', 'ameliorate', 'anomaly', 'antithesis', 'apathy',
      'arduous', 'ascertain', 'askew', 'aspersion', 'assuage', 'astute', 'attenuate',
      'augment', 'austerity', 'banal', 'belated', 'bellicose', 'benevolent', 'bolster',
    ],
  },
};

export const BAND_ORDER: VocabularyBand[] = [
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12',
];

export function bandIndex(band: VocabularyBand): number {
  return BAND_ORDER.indexOf(band);
}

export function bandFromIndex(i: number): VocabularyBand {
  return BAND_ORDER[Math.min(BAND_ORDER.length - 1, Math.max(0, i))] as VocabularyBand;
}

/** Top of band the candidate clears without error sets their vocabulary band. */
export function deriveVocabularyBand(untimedAccuracyByBand: Partial<Record<VocabularyBand, number>>): VocabularyBand {
  let reached: VocabularyBand = 'V1';
  for (const band of BAND_ORDER) {
    const acc = untimedAccuracyByBand[band];
    if (acc === undefined) continue;
    if (acc >= 90) reached = band;
    else break;
  }
  return reached;
}
