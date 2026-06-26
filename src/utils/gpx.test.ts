import { describe, it, expect } from 'vitest';
import { buildGpx } from './gpx';

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(error.textContent ?? 'XML parse error');
  return doc;
}

function textContent(parent: Element | Document, tagName: string): string | null {
  return parent.getElementsByTagName(tagName)[0]?.textContent ?? null;
}

describe('buildGpx', () => {
  it('builds a valid empty document', async () => {
    const gpx = await buildGpx({});
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('</gpx>');
    expect(gpx).not.toContain('<trk>');
    expect(gpx).not.toContain('<wpt');
  });

  it('serializes a single-point track', async () => {
    const gpx = await buildGpx({
      tracks: [{ name: 'T', segments: [[{ latitude: 1.5, longitude: -2.25 }]] }],
    });
    expect(gpx).toContain('<trk>');
    expect(gpx).toContain('<name>T</name>');
    expect(gpx).toContain('<trkpt lat="1.5" lon="-2.25">');
  });

  it('accepts a flat point array as a single segment', async () => {
    const gpx = await buildGpx({
      tracks: [
        {
          name: 'flat',
          // Intentionally passing a flat array where segments is expected.
          segments: [{ latitude: 10, longitude: 20 }] as never,
        },
      ],
    });
    expect((gpx.match(/<trkseg>/g) ?? []).length).toBe(1);
    expect(gpx).toContain('<trkpt lat="10" lon="20">');
  });

  it('serializes multi-segment tracks', async () => {
    const gpx = await buildGpx({
      tracks: [
        {
          name: 'multi',
          segments: [
            [{ latitude: 0, longitude: 0 }],
            [{ latitude: 1, longitude: 1 }],
          ],
        },
      ],
    });
    expect((gpx.match(/<trkseg>/g) ?? []).length).toBe(2);
  });

  it('includes elevation and time only when provided', async () => {
    const withMeta = await buildGpx({
      tracks: [
        {
          segments: [[{ latitude: 0, longitude: 0, elevation: 12.345, timestamp: 0 }]],
        },
      ],
    });
    expect(withMeta).toContain('<ele>12.345</ele>');
    expect(withMeta).toContain('<time>1970-01-01T00:00:00.000Z</time>');

    const without = await buildGpx({
      tracks: [{ segments: [[{ latitude: 0, longitude: 0 }]] }],
    });
    expect(without).not.toContain('<ele>');
    expect(without).not.toContain('<time>');
  });

  it('serializes waypoints with name/description escaped', async () => {
    const gpx = await buildGpx({
      waypoints: [
        { latitude: 5, longitude: 6, name: 'A & B', description: '<x>' },
      ],
    });
    expect(gpx).toContain('<wpt lat="5" lon="6">');
    expect(gpx).toContain('<name>A &amp; B</name>');
    expect(gpx).toContain('<desc>&lt;x&gt;</desc>');
  });

  it('uses a custom creator attribute', async () => {
    const gpx = await buildGpx({}, 'My Creator');
    expect(gpx).toContain('creator="My Creator"');
  });

  it('writes metadata name + time when present', async () => {
    const gpx = await buildGpx({ metadata: { name: 'Trip', time: 0 } });
    expect(gpx).toContain('<metadata>');
    expect(gpx).toContain('<name>Trip</name>');
    expect(gpx).toContain('<time>1970-01-01T00:00:00.000Z</time>');
  });

  it('omits invalid coordinates instead of writing a bogus Null Island point', async () => {
    const gpx = await buildGpx({
      waypoints: [{ latitude: NaN, longitude: Infinity, name: 'Bad' }],
      tracks: [{ segments: [[{ latitude: NaN, longitude: Infinity }, { latitude: 1, longitude: 2 }]] }],
    });
    expect(gpx).not.toContain('lat="0.0000000" lon="0.0000000"');
    expect(gpx).not.toContain('<wpt');
    expect(gpx).toContain('<trkpt lat="1" lon="2">');
  });
  it('produces XML that carries track, waypoint, elevation and time semantics', async () => {
    const source = await buildGpx({
      metadata: { name: 'rt' },
      waypoints: [{ latitude: 1.2345678, longitude: -2.3456789, name: 'WP', description: 'D & E' }],
      tracks: [
        {
          name: 'Track 1',
          segments: [
            [
              { latitude: 10.1, longitude: 20.2, elevation: 100.5, timestamp: 1_700_000_000_000 },
              { latitude: 10.2, longitude: 20.3 },
            ],
          ],
        },
      ],
    });

    const doc = parseXml(source);
    const waypoint = doc.getElementsByTagName('wpt')[0];
    expect(waypoint.getAttribute('lat')).toBe('1.2345678');
    expect(waypoint.getAttribute('lon')).toBe('-2.3456789');
    expect(textContent(waypoint, 'name')).toBe('WP');
    expect(textContent(waypoint, 'desc')).toBe('D & E');

    const track = doc.getElementsByTagName('trk')[0];
    expect(textContent(track, 'name')).toBe('Track 1');
    const trackPoints = doc.getElementsByTagName('trkpt');
    expect(trackPoints).toHaveLength(2);
    expect(trackPoints[0].getAttribute('lat')).toBe('10.1');
    expect(trackPoints[0].getAttribute('lon')).toBe('20.2');
    expect(textContent(trackPoints[0], 'ele')).toBe('100.5');
    expect(textContent(trackPoints[0], 'time')).toBe('2023-11-14T22:13:20.000Z');
    expect(textContent(trackPoints[1], 'ele')).toBeNull();
  });
});
