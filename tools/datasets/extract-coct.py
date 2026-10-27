#!/usr/bin/env python3
"""Stream the pinned COCT XLSX with Python standard library only; output JSON Lines.

Usage: python3 tools/datasets/extract-coct.py input.xlsx output.jsonl
No corpus frequency is inferred from workbook dates or combined ranking columns.
"""
import json
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def shared_strings(archive):
    values = []
    if 'xl/sharedStrings.xml' not in archive.namelist():
        return values
    with archive.open('xl/sharedStrings.xml') as stream:
        for _, node in ET.iterparse(stream, events=('end',)):
            if node.tag == '{%s}si' % NS['m']:
                values.append(''.join(part.text or '' for part in node.iter('{%s}t' % NS['m'])))
                node.clear()
    return values

def cell_value(cell, strings):
    if cell.attrib.get('t') == 'inlineStr':
        return ''.join(n.text or '' for n in cell.iter('{%s}t' % NS['m']))
    value = cell.find('m:v', NS)
    if value is None:
        return None
    return strings[int(value.text)] if cell.attrib.get('t') == 's' else value.text

def extract(source, destination):
    with zipfile.ZipFile(source) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = [s for s in workbook.findall('m:sheets/m:sheet', NS) if s.attrib['name'] == '通用詞頻表']
        if len(sheets) != 1:
            raise ValueError('Expected exactly one 通用詞頻表 sheet')
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.attrib['Target'] for r in relationships if r.attrib['Id'] == sheets[0].attrib[RID])
        sheet_path = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        strings = shared_strings(archive)
        count = 0
        with archive.open(sheet_path) as stream, open(destination, 'w', encoding='utf8', newline='\n') as out:
            for _, row in ET.iterparse(stream, events=('end',)):
                if row.tag != '{%s}row' % NS['m']:
                    continue
                cells = {''.join(c for c in cell.attrib['r'] if c.isalpha()): cell_value(cell, strings) for cell in row}
                if row.attrib.get('r') == '1':
                    if cells.get('B') != '詞' or (cells.get('I') or '').replace('\n', '') != '新聞詞頻':
                        raise ValueError('Unexpected word/news column headers')
                elif cells.get('B') is not None:
                    news = cells.get('I')
                    if news is None or not news.isdecimal():
                        raise ValueError('Non-integer news count at row ' + row.attrib.get('r', '?'))
                    out.write(json.dumps({'word': cells['B'], 'news': int(news)}, ensure_ascii=False, separators=(',', ':')) + '\n')
                    count += 1
                row.clear()
        if count != 163701:
            raise ValueError('Pinned COCT row count changed: ' + str(count))
        print(json.dumps({'sheet': '通用詞頻表', 'wordColumn': 'B', 'newsCountColumn': 'I', 'rawRows': count}))

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: extract-coct.py input.xlsx output.jsonl')
    extract(sys.argv[1], sys.argv[2])
