/**
 * 点位经纬度：种子数据与已核验 WGS84 清单一致，
 * 且已有数据库在启动时只回写 lon/lat。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { POINTS_DATA } from '../../api/points-data.js';
import { db, initDatabase } from '../../api/db.js';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/wgs84-point-coordinates.json',
);

interface CoordTruth {
  id: number;
  name: string;
  lon: string;
  lat: string;
}

const truth = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as CoordTruth[];

/** 与核验坐标比较的容差（度）。1e-8 度约等于 1 毫米量级。 */
const COORD_EPS = 1e-8;

function withinTruth(actual: number, expected: string): boolean {
  return Math.abs(actual - Number(expected)) <= COORD_EPS;
}

describe('点位经纬度种子数据', () => {
  it('141 个点的名称与经纬度都与核验清单一致', () => {
    expect(truth).toHaveLength(141);
    expect(POINTS_DATA).toHaveLength(141);

    const byId = new Map(POINTS_DATA.map((p) => [p.id, p]));
    for (const expected of truth) {
      const point = byId.get(expected.id);
      expect(point, `缺少点位 ${expected.id}`).toBeDefined();
      expect(point?.name).toBe(expected.name);
      expect(withinTruth(point!.lon, expected.lon)).toBe(true);
      expect(withinTruth(point!.lat, expected.lat)).toBe(true);
    }

    const ids = POINTS_DATA.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual(truth.map((p) => p.id).sort((a, b) => a - b));
    expect(ids).toEqual(Array.from({ length: 141 }, (_, i) => i + 1));
  });
});

describe('启动时同步已入库经纬度', () => {
  beforeAll(() => {
    initDatabase();
  });

  it('入库后的 lon/lat 与种子数据一致', () => {
    const rows = db
      .prepare('SELECT id, name, lon, lat FROM point_info ORDER BY id')
      .all() as Array<{
      id: number;
      name: string;
      lon: number;
      lat: number;
    }>;
    expect(rows).toHaveLength(141);
    for (let i = 0; i < POINTS_DATA.length; i++) {
      const seed = POINTS_DATA.find((p) => p.id === rows[i].id);
      expect(seed).toBeDefined();
      expect(rows[i].lon).toBe(seed!.lon);
      expect(rows[i].lat).toBe(seed!.lat);
      expect(rows[i].name).toBe(seed!.name);
    }
  });

  it('再次启动只更新 lon/lat，保留名称、其他字段和素材', () => {
    const pointId = 1;
    const seed = POINTS_DATA.find((p) => p.id === pointId)!;
    const before = db.prepare('SELECT * FROM point_info WHERE id = ?').get(pointId) as {
      name: string;
      city: string;
      district: string;
      township: string;
      location: string;
      station: string;
      capacity: string;
      remark: string;
    };
    const untouched = db
      .prepare('SELECT name, lon, lat, remark, capacity FROM point_info WHERE id = 2')
      .get() as {
      name: string;
      lon: number;
      lat: number;
      remark: string;
      capacity: string;
    };

    db.prepare(
      `UPDATE point_info
          SET lon = ?, lat = ?, name = ?, remark = ?, capacity = ?
        WHERE id = ?`,
    ).run(119.1, 26.1, '不应被覆盖', '保留备注', '999', pointId);

    db.prepare(
      `INSERT INTO point_info
         (id, name, city, district, township, location, station, capacity, lon, lat, remark)
       VALUES (999, '额外点位', '福州市', '连江县', '', '', '', '1', 118.5, 25.5, '不要动')`,
    ).run();

    db.prepare(
      `INSERT INTO material (point_id, material_type, file_path, file_size, upload_time)
       VALUES (?, 'img', 'point_1/coord-sync-keep.jpg', 12, '2026-01-01 00:00:00')`,
    ).run(pointId);

    initDatabase();

    const row = db.prepare('SELECT * FROM point_info WHERE id = ?').get(pointId) as {
      name: string;
      city: string;
      district: string;
      township: string;
      location: string;
      station: string;
      capacity: string;
      lon: number;
      lat: number;
      remark: string;
    };
    expect(row.lon).toBe(seed.lon);
    expect(row.lat).toBe(seed.lat);
    expect(row.name).toBe('不应被覆盖');
    expect(row.remark).toBe('保留备注');
    expect(row.capacity).toBe('999');
    expect(row.city).toBe(before.city);
    expect(row.district).toBe(before.district);
    expect(row.township).toBe(before.township);
    expect(row.location).toBe(before.location);
    expect(row.station).toBe(before.station);

    const still = db
      .prepare('SELECT name, lon, lat, remark, capacity FROM point_info WHERE id = 2')
      .get() as {
      name: string;
      lon: number;
      lat: number;
      remark: string;
      capacity: string;
    };
    expect(still).toEqual(untouched);

    const extra = db
      .prepare('SELECT name, lon, lat, remark FROM point_info WHERE id = 999')
      .get() as {
      name: string;
      lon: number;
      lat: number;
      remark: string;
    };
    expect(extra).toEqual({ name: '额外点位', lon: 118.5, lat: 25.5, remark: '不要动' });

    const materials = db
      .prepare(
        'SELECT point_id, material_type, file_path, file_size, upload_time FROM material WHERE point_id = ?',
      )
      .all(pointId) as Array<{
      point_id: number;
      material_type: string;
      file_path: string;
      file_size: number;
      upload_time: string;
    }>;
    expect(materials).toEqual([
      {
        point_id: pointId,
        material_type: 'img',
        file_path: 'point_1/coord-sync-keep.jpg',
        file_size: 12,
        upload_time: '2026-01-01 00:00:00',
      },
    ]);

    // 第二次启动：坐标已对齐，素材仍在，额外点位仍在
    initDatabase();
    const again = db
      .prepare('SELECT lon, lat, name, remark, capacity FROM point_info WHERE id = ?')
      .get(pointId) as {
      lon: number;
      lat: number;
      name: string;
      remark: string;
      capacity: string;
    };
    expect(again).toEqual({
      lon: seed.lon,
      lat: seed.lat,
      name: '不应被覆盖',
      remark: '保留备注',
      capacity: '999',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM material WHERE point_id = ?').get(pointId),
    ).toEqual({ n: 1 });
    expect(db.prepare('SELECT id FROM point_info WHERE id = 999').get()).toEqual({ id: 999 });
  });
});
