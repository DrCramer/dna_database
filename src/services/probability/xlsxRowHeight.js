// ExcelJS writes explicit heights (points); merged, wrapped cells do not have
// an AutoFit operation. Estimate wrapping conservatively without requiring OS
// fonts or a browser on the server. Default Excel column units use ~7 px.
function wrappedTextHeight(text, columnWidths, fontSize = 10) {
  const width = Math.max(8, columnWidths.reduce((sum, value) => sum + Math.floor(value * 7), 0) - 12);
  const pixelsPerEm = fontSize * 96 / 72;
  const characterWidth = char => pixelsPerEm * (/\s/u.test(char) ? .3
    : /[ilI1.,:;!|'`]/u.test(char) ? .3
    : /[MWmwЖШЩЮФЫДЦжшщюфыдц]/u.test(char) ? .9
    : /\p{Lu}/u.test(char) ? .75 : .6);
  const measure = word => [...word].reduce((sum, char) => sum + characterWidth(char), 0);
  let lines = 0;
  for (const paragraph of String(text ?? '').split(/\r\n|[\r\n]/)) {
    let lineWidth = 0; lines++;
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
      const wordWidth = measure(word), gap = lineWidth ? characterWidth(' ') : 0;
      if (lineWidth && lineWidth + gap + wordWidth > width) { lines++; lineWidth = 0; }
      else lineWidth += gap;
      if (wordWidth <= width) lineWidth += wordWidth;
      else for (const char of word) {
        const advance = characterWidth(char);
        if (lineWidth && lineWidth + advance > width) { lines++; lineWidth = 0; }
        lineWidth += advance;
      }
    }
  }
  // Leading and padding leave room for font substitution in Excel/Calc.
  return Math.min(409.5, Math.ceil(lines * fontSize * 1.3 + 8));
}
module.exports = { wrappedTextHeight };
