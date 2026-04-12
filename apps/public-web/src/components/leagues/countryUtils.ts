// Country code to flag emoji mapping
const countryToEmoji: Record<string, string> = {
  'turkey': '🇹🇷', 'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'spain': '🇪🇸', 'germany': '🇩🇪',
  'italy': '🇮🇹', 'france': '🇫🇷', 'portugal': '🇵🇹', 'netherlands': '🇳🇱',
  'belgium': '🇧🇪', 'usa': '🇺🇸', 'brazil': '🇧🇷', 'argentina': '🇦🇷',
  'mexico': '🇲🇽', 'japan': '🇯🇵', 'south korea': '🇰🇷', 'china': '🇨🇳',
  'russia': '🇷🇺', 'ukraine': '🇺🇦', 'poland': '🇵🇱', 'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'northern ireland': '🇬🇧', 'ireland': '🇮🇪', 'denmark': '🇩🇰',
  'sweden': '🇸🇪', 'norway': '🇳🇴', 'finland': '🇫🇮', 'switzerland': '🇨🇭',
  'austria': '🇦🇹', 'czech republic': '🇨🇿', 'hungary': '🇭🇺', 'romania': '🇷🇴',
  'bulgaria': '🇧🇬', 'greece': '🇬🇷', 'serbia': '🇷🇸', 'croatia': '🇭🇷',
  'slovenia': '🇸🇮', 'slovakia': '🇸🇰', 'bosnia': '🇧🇦', 'albania': '🇦🇱',
  'macedonia': '🇲🇰', 'montenegro': '🇲🇪', 'lithuania': '🇱🇹', 'latvia': '🇱🇻',
  'estonia': '🇪🇪', 'belarus': '🇧🇾', 'moldova': '🇲🇩', 'georgia': '🇬🇪',
  'azerbaijan': '🇦🇿', 'armenia': '🇦🇲', 'kazakhstan': '🇰🇿', 'uzbekistan': '🇺🇿',
  'turkmenistan': '🇹🇲', 'kyrgyzstan': '🇰🇬', 'tajikistan': '🇹🇯', 'saudi arabia': '🇸🇦',
  'qatar': '🇶🇦', 'uae': '🇦🇪', 'kuwait': '🇰🇼', 'bahrain': '🇧🇭',
  'oman': '🇴🇲', 'iran': '🇮🇷', 'iraq': '🇮🇶', 'jordan': '🇯🇴',
  'lebanon': '🇱🇧', 'syria': '🇸🇾', 'israel': '🇮🇱', 'palestine': '🇵🇸',
  'egypt': '🇪🇬', 'morocco': '🇲🇦', 'tunisia': '🇹🇳', 'algeria': '🇩🇿',
  'libya': '🇱🇾', 'sudan': '🇸🇩', 'ethiopia': '🇪🇹', 'kenya': '🇰🇪',
  'nigeria': '🇳🇬', 'ghana': '🇬🇭', 'cameroon': '🇨🇲', 'ivory coast': '🇨🇮',
  'senegal': '🇸🇳', 'mali': '🇲🇱', 'burkina faso': '🇧🇫', 'niger': '🇳🇪',
  'chad': '🇹🇩', 'gabon': '🇬🇦', 'congo': '🇨🇬', 'dr congo': '🇨🇩',
  'angola': '🇦🇴', 'zambia': '🇿🇲', 'zimbabwe': '🇿🇼', 'botswana': '🇧🇼',
  'namibia': '🇳🇦', 'mozambique': '🇲🇿', 'madagascar': '🇲🇬', 'mauritius': '🇲🇺',
  'seychelles': '🇸🇨', 'comoros': '🇰🇲', 'djibouti': '🇩🇯', 'somalia': '🇸🇴',
  'eritrea': '🇪🇷', 'tanzania': '🇹🇿', 'uganda': '🇺🇬', 'rwanda': '🇷🇼',
  'burundi': '🇧🇮', 'south africa': '🇿🇦', 'lesotho': '🇱🇸', 'eswatini': '🇸🇿',
  'malawi': '🇲🇼', 'australia': '🇦🇺', 'new zealand': '🇳🇿', 'fiji': '🇫🇯',
  'papua new guinea': '🇵🇬', 'solomon islands': '🇸🇧', 'vanuatu': '🇻🇺', 'samoa': '🇼🇸',
  'tonga': '🇹🇴', 'kiribati': '🇰🇮', 'tuvalu': '🇹🇻', 'nauru': '🇳🇷',
  'palau': '🇵🇼', 'marshall islands': '🇲🇭', 'micronesia': '🇫🇲', 'canada': '🇨🇦',
  'chile': '🇨🇱', 'colombia': '🇨🇴', 'venezuela': '🇻🇪', 'ecuador': '🇪🇨',
  'peru': '🇵🇪', 'bolivia': '🇧🇴', 'paraguay': '🇵🇾', 'uruguay': '🇺🇾',
  'guyana': '🇬🇾', 'suriname': '🇸🇷', 'french guiana': '🇬🇫', 'belize': '🇧🇿',
  'guatemala': '🇬🇹', 'honduras': '🇭🇳', 'el salvador': '🇸🇻', 'nicaragua': '🇳🇮',
  'costa rica': '🇨🇷', 'panama': '🇵🇦', 'cuba': '🇨🇺', 'jamaica': '🇯🇲',
  'haiti': '🇭🇹', 'dominican republic': '🇩🇴', 'puerto rico': '🇵🇷', 'trinidad': '🇹🇹',
  'barbados': '🇧🇧', 'bahamas': '🇧🇸', 'bermuda': '🇧🇲', 'aruba': '🇦🇼',
  'curacao': '🇨🇼', 'sint maarten': '🇸🇽', 'cayman islands': '🇰🇾', 'turks caicos': '🇹🇨',
  'british virgin islands': '🇻🇬', 'us virgin islands': '🇻🇮', 'anguilla': '🇦🇮', 'montserrat': '🇲🇸',
  'guadeloupe': '🇬🇵', 'martinique': '🇲🇶', 'saint barthelemy': '🇧🇱', 'saint martin': '🇲🇫',
  'saint pierre': '🇵🇲', 'greenland': '🇬🇱', 'iceland': '🇮🇸', 'faroe islands': '🇫🇴',
  'svalbard': '🇸🇯', 'gibraltar': '🇬🇮', 'malta': '🇲🇹', 'cyprus': '🇨🇾',
  'liechtenstein': '🇱🇮', 'monaco': '🇲🇨', 'andorra': '🇦🇩', 'san marino': '🇸🇲',
  'vatican': '🇻🇦', 'luxembourg': '🇱🇺', 'isle of man': '🇮🇲', 'jersey': '🇯🇪',
  'guernsey': '🇬🇬', 'alderney': '🇬🇬', 'sark': '🇬🇬', 'herm': '🇬🇬',
  'international': '🌍', 'europe': '🇪🇺', 'asia': '🇦🇸', 'africa': '🇦🇫',
  'south america': '🇦🇶', 'north america': '🇦🇮', 'oceania': '🇦🇺', 'world': '🌍',
};

export function getCountryEmoji(country: string | null | undefined): string {
  if (!country) return '🏳️';
  const normalized = country.toLowerCase().trim();
  return countryToEmoji[normalized] || '🏳️';
}

export function getCountryColor(country: string | null | undefined): string {
  if (!country) return 'from-slate-700 to-slate-800';
  const normalized = country.toLowerCase().trim();
  
  const colors: Record<string, string> = {
    'turkey': 'from-red-600 to-red-800',
    'england': 'from-white to-slate-200',
    'spain': 'from-red-500 to-yellow-500',
    'germany': 'from-black to-red-600',
    'italy': 'from-green-600 to-red-600',
    'france': 'from-blue-600 to-red-600',
    'portugal': 'from-green-600 to-red-600',
    'netherlands': 'from-orange-500 to-red-600',
    'brazil': 'from-green-500 to-yellow-400',
    'argentina': 'from-sky-400 to-white',
    'usa': 'from-blue-600 to-red-600',
  };
  
  return colors[normalized] || 'from-slate-700 to-slate-800';
}
