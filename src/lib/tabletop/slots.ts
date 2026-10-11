// Swap-remove slots for instanced batches (#266): the figures' (figures.ts).

/** Swap-remove slots: ids packed in `owners[0..size)`. */
export class Slots {
	readonly owners: string[] = [];
	private readonly at = new Map<string, number>();

	get size(): number {
		return this.owners.length;
	}

	slotOf(id: string): number | undefined {
		return this.at.get(id);
	}

	/** Puts `id` in the next slot and returns it. */
	add(id: string): number {
		const slot = this.owners.length;
		this.owners.push(id);
		this.at.set(id, slot);
		return slot;
	}

	/** Frees `id`'s slot: the last moved into it (`from`, equal to `slot` when it was the last). */
	remove(id: string): { slot: number; from: number } | null {
		const slot = this.at.get(id);
		if (slot === undefined) return null;
		const from = this.owners.length - 1;
		const last = this.owners.pop()!;
		this.at.delete(id);
		if (slot !== from) {
			this.owners[slot] = last;
			this.at.set(last, slot);
		}
		return { slot, from };
	}
}
