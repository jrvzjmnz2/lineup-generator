// Puts a person's name into Title Case, whatever it was typed in:
//   "juan DELA cruz"   -> "Juan Dela Cruz"
//   "mary-ann o'neil"  -> "Mary-Ann O'Neil"
//   "jose rizal iii"   -> "Jose Rizal III"
//
// Each word is lower-cased and its first letter raised, and the same happens
// after a hyphen or apostrophe. Roman-numeral suffixes (II, III, IV...) stay
// in capitals, but only after the first word, so a first name like "Vi" is
// left alone. Extra spaces are collapsed.
const ROMAN_SUFFIX = /^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

function capitalizePart(part) {
  if (!part) return part;
  return part.charAt(0).toLocaleUpperCase('en') + part.slice(1).toLocaleLowerCase('en');
}

function properName(raw) {
  const text = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text
    .split(' ')
    .map((word, i) =>
      i > 0 && ROMAN_SUFFIX.test(word)
        ? word.toUpperCase()
        : word.split(/([-'’])/).map(capitalizePart).join('')
    )
    .join(' ');
}

module.exports = { properName };
