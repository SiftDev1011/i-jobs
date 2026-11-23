/**
 * Countries, their common names and big job cities, and the regions they belong to.
 * Region letters: A sub-Saharan Africa, N North Africa, E Europe, M Middle East,
 * U US/Canada, L Latin America and the Caribbean, S Asia, O Oceania.
 */
const RAW = `
AO:Angola|Luanda:A
BJ:Benin|Cotonou:A
BW:Botswana|Gaborone:A
BF:Burkina Faso:A
BI:Burundi:A
CV:Cabo Verde|Cape Verde:A
CM:Cameroon|Douala|Yaounde|Yaoundé:A
CF:Central African Republic:A
TD:Chad:A
KM:Comoros:A
CD:Democratic Republic of the Congo|DR Congo|Congo-Kinshasa|Kinshasa:A
CG:Republic of the Congo|Congo-Brazzaville|Congo:A
CI:Côte d'Ivoire|Cote d'Ivoire|Ivory Coast|Abidjan:A
DJ:Djibouti:A
GQ:Equatorial Guinea:A
ER:Eritrea:A
SZ:Eswatini|Swaziland:A
ET:Ethiopia|Addis Ababa:A
GA:Gabon:A
GM:The Gambia|Gambia:A
GH:Ghana|Accra|Kumasi:A
GW:Guinea-Bissau:A
GN:Guinea|Conakry:A
KE:Kenya|Nairobi|Mombasa|Kisumu:A
LS:Lesotho:A
LR:Liberia|Monrovia:A
MG:Madagascar:A
MW:Malawi|Lilongwe:A
ML:Mali|Bamako:A
MU:Mauritius:A
MZ:Mozambique|Maputo:A
NA:Namibia|Windhoek:A
NG:Nigeria|Lagos|Abuja|Port Harcourt|Ibadan|Kano|Enugu|Benin City|Kaduna|Abeokuta|Uyo|Ikeja|Lekki|Victoria Island|Naija:A
NE:Niger|Niamey:A
RW:Rwanda|Kigali:A
ST:Sao Tome and Principe|São Tomé and Príncipe:A
SN:Senegal|Dakar:A
SC:Seychelles:A
SL:Sierra Leone|Freetown:A
SO:Somalia|Mogadishu:A
ZA:South Africa|Johannesburg|Cape Town|Durban|Pretoria|Gauteng:A
SS:South Sudan|Juba:A
TZ:Tanzania|Dar es Salaam|Dodoma|Zanzibar:A
TG:Togo|Lome|Lomé:A
UG:Uganda|Kampala:A
ZM:Zambia|Lusaka:A
ZW:Zimbabwe|Harare:A
DZ:Algeria|Algiers:N
EG:Egypt|Cairo|Alexandria:N
LY:Libya|Tripoli:N
MR:Mauritania:N
MA:Morocco|Casablanca|Rabat|Marrakech:N
SD:Sudan|Khartoum:N
TN:Tunisia|Tunis:N
AL:Albania|Tirana:E
AD:Andorra:E
AM:Armenia|Yerevan:E
AT:Austria|Vienna:E
AZ:Azerbaijan|Baku:E
BY:Belarus|Minsk:E
BE:Belgium|Brussels|Antwerp:E
BA:Bosnia and Herzegovina|Sarajevo:E
BG:Bulgaria|Sofia:E
HR:Croatia|Zagreb:E
CY:Cyprus|Nicosia|Limassol:E
CZ:Czech Republic|Czechia|Prague|Brno:E
DK:Denmark|Copenhagen:E
EE:Estonia|Tallinn:E
FI:Finland|Helsinki:E
FR:France|Paris|Lyon:E
GE:Georgia|Tbilisi:E
DE:Germany|Deutschland|Berlin|Munich|München|Hamburg|Frankfurt|Cologne:E
GR:Greece|Athens:E
HU:Hungary|Budapest:E
IS:Iceland|Reykjavik:E
IE:Ireland|Dublin|Cork:E
IT:Italy|Milan|Rome|Turin:E
XK:Kosovo|Pristina:E
LV:Latvia|Riga:E
LI:Liechtenstein:E
LT:Lithuania|Vilnius:E
LU:Luxembourg:E
MT:Malta:E
MD:Moldova|Chisinau:E
MC:Monaco:E
ME:Montenegro:E
NL:Netherlands|The Netherlands|Holland|Amsterdam|Rotterdam|Utrecht|Eindhoven:E
MK:North Macedonia|Macedonia|Skopje:E
NO:Norway|Oslo:E
PL:Poland|Warsaw|Krakow|Kraków|Wroclaw|Wrocław|Gdansk:E
PT:Portugal|Lisbon|Porto:E
RO:Romania|Bucharest|Cluj-Napoca|Cluj:E
RU:Russia|Russian Federation|Moscow:E
SM:San Marino:E
RS:Serbia|Belgrade|Novi Sad:E
SK:Slovakia|Bratislava:E
SI:Slovenia|Ljubljana:E
ES:Spain|Madrid|Barcelona|Valencia:E
SE:Sweden|Stockholm|Gothenburg:E
CH:Switzerland|Zurich|Zürich|Geneva|Basel:E
TR:Turkey|Türkiye|Turkiye|Istanbul|Ankara:EM
UA:Ukraine|Kyiv|Kiev|Lviv:E
GB:United Kingdom|Great Britain|Britain|England|Scotland|Wales|Northern Ireland|London|Manchester|Edinburgh|Birmingham|Bristol|Leeds|Glasgow:E
AE:United Arab Emirates|Dubai|Abu Dhabi|Sharjah:M
SA:Saudi Arabia|Riyadh|Jeddah:M
QA:Qatar|Doha:M
KW:Kuwait:M
BH:Bahrain|Manama:M
OM:Oman|Muscat:M
JO:Jordan|Amman:M
LB:Lebanon|Beirut:M
IL:Israel|Tel Aviv|Jerusalem:M
IQ:Iraq|Baghdad:M
IR:Iran|Tehran:M
PS:Palestine:M
YE:Yemen:M
SY:Syria:M
US:United States of America|United States|New York City|New York|NYC|San Francisco|Bay Area|Silicon Valley|Los Angeles|Seattle|Austin|Boston|Chicago|Denver|Atlanta|Miami|Washington DC|Washington, DC|Philadelphia|Dallas|Houston|San Diego|Portland|Pittsburgh|Minneapolis|Nashville|Phoenix|Salt Lake City:U
CA:Canada|Toronto|Vancouver|Montreal|Montréal|Ottawa|Calgary|Ontario|Quebec|Québec|British Columbia|Alberta:U
MX:Mexico|México|Mexico City|Guadalajara|Monterrey:LU
GT:Guatemala:L
BZ:Belize:L
HN:Honduras:L
SV:El Salvador:L
NI:Nicaragua:L
CR:Costa Rica|San Jose, Costa Rica:L
PA:Panama:L
CU:Cuba:L
DO:Dominican Republic|Santo Domingo:L
JM:Jamaica|Kingston:L
HT:Haiti:L
TT:Trinidad and Tobago:L
PR:Puerto Rico:L
AR:Argentina|Buenos Aires|Córdoba:L
BO:Bolivia:L
BR:Brazil|Brasil|São Paulo|Sao Paulo|Rio de Janeiro|Belo Horizonte|Curitiba|Florianópolis|Porto Alegre:L
CL:Chile|Santiago:L
CO:Colombia|Bogota|Bogotá|Medellin|Medellín|Cali:L
EC:Ecuador|Quito:L
GY:Guyana:L
PY:Paraguay:L
PE:Peru|Perú|Lima:L
SR:Suriname:L
UY:Uruguay|Montevideo:L
VE:Venezuela|Caracas:L
AF:Afghanistan:S
BD:Bangladesh|Dhaka:S
BT:Bhutan:S
BN:Brunei:S
KH:Cambodia|Phnom Penh:S
CN:China|Beijing|Shanghai|Shenzhen|Guangzhou:S
HK:Hong Kong:S
TW:Taiwan|Taipei:S
IN:India|Bangalore|Bengaluru|Mumbai|Delhi|New Delhi|Hyderabad|Pune|Chennai|Gurgaon|Gurugram|Noida|Kolkata:S
ID:Indonesia|Jakarta|Bali:S
JP:Japan|Tokyo|Osaka:S
KZ:Kazakhstan|Almaty:S
KG:Kyrgyzstan:S
LA:Laos:S
MY:Malaysia|Kuala Lumpur:S
MV:Maldives:S
MN:Mongolia:S
MM:Myanmar:S
NP:Nepal|Kathmandu:S
KR:South Korea|Korea|Seoul:S
PK:Pakistan|Karachi|Lahore|Islamabad:S
PH:Philippines|Manila|Cebu:S
SG:Singapore:S
LK:Sri Lanka|Colombo:S
TJ:Tajikistan:S
TH:Thailand|Bangkok:S
TL:Timor-Leste:S
TM:Turkmenistan:S
UZ:Uzbekistan|Tashkent:S
VN:Vietnam|Viet Nam|Ho Chi Minh City|Hanoi:S
AU:Australia|Sydney|Melbourne|Brisbane|Perth:O
NZ:New Zealand|Auckland|Wellington:O
FJ:Fiji:O
PG:Papua New Guinea:O
`;

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};
export const CA_PROVINCES = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'];

const LETTER_REGIONS: Record<string, string[]> = {
  A: ['africa', 'emea'],
  N: ['africa', 'mena', 'emea'],
  E: ['europe', 'emea'],
  M: ['middle_east', 'mena', 'emea'],
  U: ['north_america', 'americas'],
  L: ['latam', 'americas'],
  S: ['asia', 'apac'],
  O: ['oceania', 'apac'],
};

export interface CountryInfo {
  code: string;
  name: string;
  regions: string[];
}

export const COUNTRIES = new Map<string, CountryInfo>();
/** [lower-case name or city, ISO code], longest first so "Equatorial Guinea" wins over "Guinea". */
export const PLACE_NAMES: [string, string][] = [];

for (const line of RAW.trim().split('\n')) {
  const [code, names, letters] = line.split(':');
  const list = names.split('|');
  const regions = [...new Set([...letters].flatMap((l) => LETTER_REGIONS[l]))];
  COUNTRIES.set(code, { code, name: list[0], regions });
  for (const n of list) PLACE_NAMES.push([n.toLowerCase(), code]);
}
for (const name of Object.values(US_STATES)) {
  if (name !== 'Georgia') PLACE_NAMES.push([name.toLowerCase(), 'US']);
}
PLACE_NAMES.sort((a, b) => b[0].length - a[0].length);

/** Regions a country counts as part of, e.g. NG → africa, emea. */
export function regionsOf(code: string): string[] {
  return COUNTRIES.get(code.toUpperCase())?.regions ?? [];
}

export const REGION_WORDS: [RegExp, string][] = [
  [/\b(sub-?saharan africa|west africa|east africa|southern africa|central africa|africa|african)\b/, 'africa'],
  [/\b(mena|north africa)\b/, 'mena'],
  [/\bemea\b/, 'emea'],
  [/\b(european union|europe|european|eea|schengen)\b/, 'europe'],
  [/\b(latam|latin america|south america|central america|caribbean)\b/, 'latam'],
  [/\bnorth america\b/, 'north_america'],
  [/\b(the americas|americas)\b/, 'americas'],
  [/\b(apac|asia[- ]pacific)\b/, 'apac'],
  [/\b(asia|southeast asia|south asia)\b/, 'asia'],
  [/\b(middle east|gcc)\b/, 'middle_east'],
  [/\boceania\b/, 'oceania'],
];
