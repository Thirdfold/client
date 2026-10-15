import { describe, expect, it } from 'vitest';
import { cloudLook } from './cloud-look';

const clear = { kind: 'none' as const, intensity: 0 };

describe('cloud shadows', () => {
	it('are off on the low tier, with the sun down and under an enclosed sky (-90)', () => {
		expect(cloudLook(clear, 50, true).strength).toBe(0);
		expect(cloudLook(clear, 0, false).strength).toBe(0);
		expect(cloudLook(clear, -90, false).strength).toBe(0);
		expect(cloudLook(clear, 50, false).strength).toBeGreaterThan(0);
	});

	it('cover more and darker with rain, storm, snow and fog than in clear weather', () => {
		const base = cloudLook(clear, 50, false);
		for (const kind of ['rain', 'storm', 'snow', 'fog'] as const) {
			const look = cloudLook({ kind, intensity: 1 }, 50, false);
			expect(look.threshold).toBeLessThan(base.threshold);
			expect(look.strength).toBeGreaterThan(base.strength);
		}
	});

	it('rise with intensity and fade in as the sun climbs', () => {
		const at = (i: number) => cloudLook({ kind: 'storm', intensity: i }, 50, false).threshold;
		expect(at(0.8)).toBeLessThan(at(0.2));
		expect(cloudLook(clear, 3, false).strength).toBeLessThan(cloudLook(clear, 30, false).strength);
	});
});
