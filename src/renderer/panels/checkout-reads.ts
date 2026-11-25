import type { DiffQuestion } from '../../shared/diff/types';
import type { ClaudeUiApi } from '../../shared/types';
import type { Watched } from './run';
import { TreeWatch } from './tree-watch';

/** A checkout's changed files for one question, as git last said them, or why git would not say. */
export type ChangesRead = Awaited<ReturnType<ClaudeUiApi['diffSummary']>>;

/** What the reads ask main. */
export type ChangesBridge = Pick<ClaudeUiApi, 'diffSummary' | 'panelTree'>;

interface Follower {
  question: DiffQuestion;
  heard: (read: ChangesRead) => void;
  /** The last read it was told, as text, with the tree it was read in, so the same answer about the same tree tells it nothing. */
  told: string | null;
}

/** One checkout while anyone follows it: who does, and its working tree's watch. */
interface Checkout {
  followers: Set<Follower>;
  watch: TreeWatch;
  /** Reads of it under way: what they change in git's own files is no change to the tree. */
  reading: number;
  /** The tree each question was last read in, by its fingerprint; null for a tree git would not look at. */
  seen: Map<DiffQuestion, string | null>;
}

/**
 * ONE READ OF A CHECKOUT'S CHANGES FOR EVERY READER: the Explorer and each Editor tab on that checkout follow it rather than each asking git and each watching the tree.
 * A checkout is watched while anyone follows it, on one `TreeWatch`; a change found reads it again once for each question followed.
 * Any read that finds the tree changed since another question followed was last read here reads that one again too, so a read for one question never hides a change from the followers of another.
 * A read asked while the same one, of the same folder and question, is under way joins it.
 * A follower is told each read of its question, unless it says what the last one it was told said about the same tree: a file edited again changes the tree, and so tells it, even where the list of changed files reads the same.
 * Followed by the checkout's root, the folder git answers with: a read git answers from a folder inside it is told to the root's followers.
 */
export class CheckoutReads {
  private readonly checkouts = new Map<string, Checkout>();
  private readonly underWay = new Map<string, Promise<ChangesRead>>();

  constructor(private readonly bridge: () => ChangesBridge) {}

  /** Hear every read of `root`'s changes for `question`, from whoever asked, the checkout watched while anyone follows it; what it returns stops it. */
  follow(root: string, question: DiffQuestion, heard: (read: ChangesRead) => void): () => void {
    const checkout = this.checkouts.get(root) ?? this.watched(root);
    const follower: Follower = { question, heard, told: null };
    checkout.followers.add(follower);
    return () => {
      checkout.followers.delete(follower);
      if (checkout.followers.size > 0 || this.checkouts.get(root) !== checkout) return;
      checkout.watch.stop();
      this.checkouts.delete(root);
    };
  }

  /** The question the first reader still following the checkout at `root` follows, such as the Explorer showing it; null while nobody follows it. */
  followedQuestion(root: string): DiffQuestion | null {
    const first = this.checkouts.get(root)?.followers.values().next();
    return first && !first.done ? first.value.question : null;
  }

  /** Read `dir`'s changes for `question` now, joining a read of the same already under way; the root's followers hear the answer before it is returned. */
  read(dir: string, question: DiffQuestion): Promise<ChangesRead> {
    const key = `${question}\0${dir}`;
    const going = this.underWay.get(key);
    if (going) return going;
    const read = this.ask(dir, question).finally(() => this.underWay.delete(key));
    this.underWay.set(key, read);
    return read;
  }

  /**
   * Read every followed checkout again, for each question followed there, after something outside its working tree changed what a read answers, such as the base kept for it; the tree's watch never sees such a change.
   * A read already under way may have started before that change, and one asked from a folder inside a checkout answers for the checkout too, so every read under way is waited for, rather than joined, before any is asked again.
   */
  async readAgain(): Promise<void> {
    await Promise.allSettled(this.underWay.values());
    await Promise.all([...this.checkouts].flatMap(([root, checkout]) => [...followedQuestions(checkout)].map((question) => this.read(root, question))));
  }

  private async ask(dir: string, question: DiffQuestion): Promise<ChangesRead> {
    const asked = this.checkouts.get(dir);
    if (asked) asked.reading++;
    let read: ChangesRead;
    try {
      read = await this.bridge().diffSummary(dir, question);
    } finally {
      if (asked) asked.reading--;
    }
    const root = read.kind === 'summary' ? read.summary.root : dir;
    const checkout = this.checkouts.get(root);
    if (!checkout) return read;
    // The tree as the read left it: what it is told against, and the watch's baseline, so what git wrote of its own while reading is no change.
    const tree = await this.look(root);
    const fingerprint = tree?.fingerprint ?? null;
    checkout.seen.set(question, fingerprint);
    for (const other of followedQuestions(checkout)) if (other !== question && checkout.seen.has(other) && checkout.seen.get(other) !== fingerprint) void this.read(root, other);
    if (checkout.reading === 0) checkout.watch.settle(tree);
    this.tell(checkout, question, read, fingerprint);
    return read;
  }

  /** Tell `checkout`'s followers of `question` a read, made in the tree `fingerprint`, each that was not told the same about the same tree last. */
  private tell(checkout: Checkout, question: DiffQuestion, read: ChangesRead, fingerprint: string | null): void {
    const said = `${fingerprint}\0${JSON.stringify(read)}`;
    for (const follower of [...checkout.followers]) {
      if (follower.question !== question || follower.told === said) continue;
      follower.told = said;
      follower.heard(read);
    }
  }

  /** Start watching `root`, its baseline the tree as it is now. */
  private watched(root: string): Checkout {
    const checkout: Checkout = {
      followers: new Set(),
      reading: 0,
      seen: new Map(),
      watch: new TreeWatch({
        watching: () => true,
        runnable: () => checkout.followers.size > 0,
        running: () => checkout.reading > 0,
        look: () => this.look(root),
        changed: () => {
          for (const question of followedQuestions(checkout)) void this.read(root, question);
        },
      }),
    };
    this.checkouts.set(root, checkout);
    void this.look(root).then((watched) => checkout.watch.settle(watched));
    checkout.watch.start();
    return checkout;
  }

  private async look(dir: string): Promise<Watched | null> {
    const tree = await this.bridge().panelTree(dir);
    return tree.kind === 'tree' ? { dir, fingerprint: tree.fingerprint } : null;
  }
}

/** The questions `checkout`'s followers follow, each once. */
function followedQuestions(checkout: Checkout): Set<DiffQuestion> {
  return new Set([...checkout.followers].map((follower) => follower.question));
}

/** The window's one set of checkout reads, over the bridge. */
export const checkoutReads = new CheckoutReads(() => window.claudeUi);
