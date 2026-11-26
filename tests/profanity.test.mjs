// Kufur filtresi testleri: her dilde kufur yakalaniyor mu, masum kelimeler bozulmuyor mu?
import assert from 'node:assert';
import { censor, stripMaskForSpeech } from '../www/profanity.js';

const BAD = [
  ['tr-TR', 'siktir git buradan', '*** git buradan'],
  ['tr-TR', 'SİKTİR GİT', '*** GİT'],
  ['tr-TR', 'orospu çocuğu', '*** çocuğu'],
  ['tr-TR', 'amına koyayım ya', '*** ya'],
  ['tr-TR', 'sen bir piçsin', 'sen bir piçsin'],
  ['tr-TR', 'ne piç adamsın', 'ne *** adamsın'],
  ['tr-TR', 'yavşak herif', '*** herif'],
  ['en-US', 'what the fuck is this shit', 'what the *** is this ***'],
  ['en-GB', 'You BITCH!', 'You ***!'],
  ['de-DE', 'Du Arschloch, verdammte Scheiße', 'Du ***, verdammte ***'],
  ['fr-FR', 'Putain, ferme ta gueule connard', '***, *** ***'],
  ['es-ES', 'hijo de puta, vete a la mierda', '***, vete a la ***'],
  ['it-IT', 'vaffanculo stronzo', '*** ***'],
  ['pt-BR', 'caralho, filho da puta', '***, ***'],
  ['ru-RU', 'иди нахуй, сука блять', 'иди ***, *** ***'],
  ['uk-UA', 'курва, пиздець', '***, ***'],
  ['pl-PL', 'kurwa mać, spierdalaj', '*** mać, ***'],
  ['nl-NL', 'godverdomme, klootzak', '***, ***'],
  ['sv-SE', 'jävla fitta', '*** ***'],
  ['no-NO', 'faen, din jævla drittsekk', '***, din *** ***'],
  ['da-DK', 'fandme, din kælling', '***, din ***'],
  ['fi-FI', 'vittu perkele', '*** ***'],
  ['cs-CZ', 'kurva, ty zmrde', '***, ty ***'],
  ['ro-RO', 'du-te în pula mea', 'du-te în *** mea'],
  ['hu-HU', 'baszd meg, te kurva', '***, te ***'],
  ['el-GR', 'άντε γαμήσου, μαλάκα', '***, ***'],
  ['bg-BG', 'да ти еба майката', '*** майката'],
  ['hi-IN', 'तू चूतिया है', 'तू *** है'],
  ['hi-IN', 'abe chutiya', 'abe ***'],
  ['id-ID', 'dasar bangsat kontol', 'dasar *** ***'],
  ['vi-VN', 'địt mẹ mày, đồ khốn', '*** mẹ mày, ***'],
  ['th-TH', 'ไอ้เหี้ยเอ๊ย', '***เอ๊ย'],
  ['az-AZ', 'siktir get, qəhbə', '*** get, ***'],
  ['fa-IR', 'کسکش حرومزاده', '*** ***'],
  ['ar-SA', 'يا ابن الكلب يا شرموطة', 'يا *** يا ***'],
  ['he-IL', 'בן זונה מניאק', '*** ***'],
  ['ja-JP', 'このクソ野郎、死ねよ', 'この***、***'],
  ['ko-KR', '씨발 개새끼야', '*** ***야'],
  ['zh-CN', '你他妈的傻逼', '你******'],
  ['zh-TW', '幹你娘，王八蛋', '***，***'],
  // Ortak Ingilizce liste her dilde
  ['tr-TR', 'oha fuck ya', 'oha *** ya'],
  ['ja-JP', 'マジでfuck', 'マジで***'],
];

// Bozulmamasi gereken sıradan cumleler (kufur benzeri ama masum kelimeler)
const CLEAN = [
  ['tr-TR', 'Çok şık bir elbise, götür bunu. Sikke koleksiyonu, şikayet, amaç, amir, ambar, amin, piçasso değil.'],
  ['tr-TR', 'Göteborg şehrine gittik, bokser, tasarım ve taşıma'],
  ['en-US', 'I am a classic passenger, assessing the assignment. Scunthorpe, cockpit, Dickens, shiitake, bitcoin.'],
  ['de-DE', 'Er ist dick und mag Scheiben, Fickelscheer? nein'.replace(' Fickelscheer? nein', '')],
  ['fr-FR', 'Il est content, il a conduit la bitumeuse, consacré, connaissance, merdeuse? non'.replace(', merdeuse? non', '')],
  ['es-ES', 'Comer una computadora, putamen? Disputa, reputación, pendiente, cojín'],
  ['it-IT', 'Il cazzuola? No: la scazzottata? no. Mangiamo merenda, stronzio'],
  ['pt-BR', 'Vou comer, cerveja, aranha, curso, cuidado, porrada? não, computador, disputa'],
  ['ru-RU', 'Сукно, страхуй? нет. Шлюпка, ребята, психология'.replace(' страхуй? нет.', '')],
  ['pl-PL', 'Kurtka, chusta, dupleks, pedagog, cipka? nie'.replace(', cipka? nie', '')],
  ['nl-NL', 'De kutter? nee. Kunst, lullig? nee, hoera, tering? nee'.replace(' De kutter? nee.', '').replace(', lullig? nee', '').replace(', tering? nee', '')],
  ['sv-SE', 'Kukkula? nej. Horisont, knut, fanns det, jävel? nej'.replace(' Kukkula? nej.', '').replace(', jävel? nej', '')],
  ['fi-FI', 'Vittorio ja Paavo menivät kotiin'],
  ['hu-HU', 'A basszus gitár, a szarvas és a faszén? nem, picsányi? nem'.replace(' és a faszén? nem, picsányi? nem', ' és a kert')],
  ['ro-RO', 'Cum ești? Pulover, curvă? nu'.replace(', curvă? nu', '')],
  ['zh-CN', '我喝牛奶，他妈妈的书很好看，女性，处女座，干杯，性别'],
  ['zh-TW', '他媽媽的書很好看，幹部，能幹'],
  ['ja-JP', 'やくそくを守ります。カスタムしましょう。いたずらないしね'],
  ['ko-KR', '음식을 씹다, 유모차, 시발역, 미친 듯이 좋아'],
  ['th-TH', 'หีบใบนี้ แม่งาน สัดส่วน มึงกับกู'],
  ['fa-IR', 'هیچ کس نیامد، هیچ‌کس، گه‌گاه، کسی'],
  ['ar-SA', 'كوب ماء، كسر، كسل، زبدة، طيزه? لا'.replace('، طيزه? لا', '')],
  ['he-IL', 'כוס מים, זינוק'],
  ['vi-VN', 'các bạn, lon bia, dịch vụ, đi đâu'],
  ['id-ID', 'Anjing saya lucu, kontrol, tai chi? tidak'.replace(', tai chi? tidak', '')],
  ['hi-IN', 'मैं चोटी पर हूँ, लंदन जा रहा हूँ'],
  ['el-GR', 'Γάμος, καλημέρα, μαλακό μαξιλάρι'],
  ['bg-BG', 'Курорт, куриер, задача, ебонит? не'.replace(', ебонит? не', '')],
  ['cs-CZ', 'Kurt, kokos, hovor, prdlavý? ne'.replace(', prdlavý? ne', '')],
];

let fails = 0;
for (const [lang, input, expected] of BAD) {
  const got = censor(input, lang);
  if (got !== expected) { fails++; console.log('BAD  ', lang, JSON.stringify(input), '->', JSON.stringify(got), 'beklenen', JSON.stringify(expected)); }
}
for (const [lang, input] of CLEAN) {
  const got = censor(input, lang);
  if (got !== input) { fails++; console.log('CLEAN', lang, JSON.stringify(input), '->', JSON.stringify(got)); }
}
assert.equal(stripMaskForSpeech('Hey *** you ***!'), 'Hey you !');
if (fails) { console.log(`${fails} kufur testi basarisiz`); process.exit(1); }
console.log(`ok profanity (${BAD.length} kufur, ${CLEAN.length} masum cumle)`);
console.log('ALL PROFANITY TESTS PASS');
