// typescript-opentimestamps: An OpenTimestamps client written in TypeScript.
// Copyright (C) 2024  La Crypta
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * This library will allow you to interact with Timestamps.
 *
 * # What are "timestamps"?
 *
 * Timestamps are a way of attesting you had knowledge of a particular byte sequence at least at a specific point in time.
 * The idea behind this is that you must somehow "commit" yourself to a value that you could not have guessed at the moment.
 *
 * One such "value that you could not have guessed at the moment" is the Merkle root of a blockchain block... so long as "the moment" is no further away than the block's generation time.
 *
 * On the other hand... what does "committing" mean?
 * The general idea is to provide a hash of the data to attest, since hashes are (hopefully) non-reversible, you have effectively committed to the data itself.
 *
 * And, oversimplifying, that's pretty much what OpenTimestamps does.
 *
 * # How does OpenTimestamps work?
 *
 * The best way to understand the OpenTimestamps workflow is by following along a full example, one such prototypical flow is show below:
 *
 * ```mermaid
 * sequenceDiagram
 *     autonumber
 *     participant U as User
 *     participant C as Calendar
 *     participant B as Blockchain
 *     %
 *     U ->> C: submit
 *     activate U
 *     activate B
 *     activate C
 *     C -->> U: pending attestation
 *     deactivate C
 *     deactivate U
 *     %
 *     C -) B: transaction
 *     activate C
 *     B --) C: transaction added to block
 *     deactivate C
 *     %
 *     U ->> C: upgrade
 *     activate U
 *     activate C
 *     C -->> U: upgraded tree
 *     deactivate C
 *     deactivate U
 *     %
 *     U ->> B: query for Merkle root
 *     activate U
 *     B -->> U: Merkle root
 *     %
 *     deactivate B
 * ```
 *
 * There are three noteworthy _agents_:
 *
 * 1. The **Client** (ie. you): is the one wanting to attest the existence of some data.
 * 2. The **Calendar** (likely one of OpenTimestamp's default calendars): is a server that will collect several such requests from different clients, merge them all together likely in a Merkle-tree-like manner (note that this is _not_ the same as the Blockchain's Merkle tree, this is simply a Calendar's implementation detail you need not be concerned with), and eventually send them over to the Blockchain proper.
 * 3. The **Blockchain** in question: is what acts as the actual "notary" and generates a block's Merkle root from _all_ the transactions therein, including the one published by the Calendars.
 *
 * Let us now consider each interaction in turn:
 *
 * 1. Firstly, the Client _submits_ a value to a Calendar: this is done by performing an HTTP `POST` request to the Calendar's `/digest` endpoint, with the data to submit as the request's body.
 * 2. The Calendar will record this and return a "tree" with a "pending" validation leaf: this is simply a list of operations that you'll need to apply to the value submitted in (1) to arrive at a "pending" validation leaf; these in turn consist of an URL that we'll use in step (5).
 * 3. Eventually, the Calendar will submit a transaction on the Blockchain: this happens asynchronously, and is outside of the Client's control, the Calendar will keep accumulating attestation requests until it sees fit to submit a transaction (criteria vary, but donations and transaction costs are expected to play a role in this).
 * 4. Eventually, the published transaction will be mined in a block on the target Blockchain: when this happens, the Calendar will update all of its stored pending attestations so as to know how to answer in step (6).
 * 5. The Client may now _upgrade_ the "pending" timestamp obtained in step (2): after the transaction has been included in the Blockchain, the Client may query the calendar by performing an HTTP `GET` request to `{pendingLeafUrl}/timestamp/{message}`, where `pendingLefUrl` is the URL mentioned in step (2), and `message` is the result of executing the list of operations retrieved in step (2) on the original data.
 * 6. The Calendar will query its internal state and respond with an upgraded timestamp: this is simply another "tree" which will take the place of the "pending" leaf, and eventually end in a "definitive" attestation containing the block-height where the resulting Merkle-root may be queried.
 * 7. The Client (any Client, actually) may now query the Blockchain: this merely entails retrieving the block at a timestamp's "definitive"-leaf's block-height and obtaining the block's Merkle-root.
 * 8. Finally, the Client (any Client) may verify the timestamp: this is achieved by executing the list of operations specified in the "tree", and comparing the result with the Blockchain's retrieved block Merkle-root, if they match, the timestamp is valid for that block's mining time, otherwise, the timestamp is invalid.
 *
 * There are a couple more things one may do with a timestamp:
 *
 * - A timestamp may be stored as a byte sequence by serializing the tree and some additional metadata.
 * - A timestamp may be read from a byte stream and deserialized into a tree.
 * - A timestamp may be _shrunk_ by keeping only the earliest "definitive" leaf.
 *
 * An the library will allow you to query for when all of these operations are applicable.
 *
 * @packageDocumentation
 * @module typescript-opentimestamps
 */

import type { Timestamp } from './types';

export type { FileHash, Leaf, MergeMap, MergeSet, Op, Timestamp, Tree, Verifier } from './types';

import { info as _info } from './info';
import { newTree as _newTree } from './internals';
import { canShrink as _canShrink, canUpgrade as _canUpgrade, canVerify as _canVerify } from './predicates';
import { read as _read } from './read';
import { shrink as _shrink } from './shrink';
import { submit as _submit } from './submit';
import { upgrade as _upgrade } from './upgrade';
import { assert as _assert, is as _is, validate as _validate } from './validation';
import { write as _write } from './write';

import { verify as _verify } from './verify';
import { default as _verifiers } from './verifiers';

/**
 * Construct an empty {@link Tree}.
 *
 * @example
 * ```typescript
 * import { newTree } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(newTree());
 *   // { edges: EdgeMap {}, leaves: LeafSet {} }
 * ```
 *
 * @returns The empty {@link Tree} constructed.
 */
export const newTree = _newTree;

/**
 * Generate a human-readable string form the given {@link Timestamp}.
 *
 * Human-readable strings are generated as a concatenation of:
 *
 * - The {@link Timestamp}'s `version` (as a _"faux comment"_, and only if the `verbose` parameter is true).
 * - The {@link Timestamp}'s `fileHash` as a simple function call.
 * - Function call trees for the main {@link Timestamp} `tree`.
 *
 * @example
 * ```typescript
 * import type { Timestamp } from '@opentimestamps/typescript-opentimestamps';
 *
 * import { info, read } from '@opentimestamps/typescript-opentimestamps';
 *
 * const timestamp: Timestamp = read(Uint8Array.of(
 *   0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *   0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *   0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *   0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *   0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *   0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xf1,
 *   0x03, 0x01, 0x02, 0x03, 0xff, 0xf1, 0x03, 0x04, 0x05,
 *   0x06, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19,
 *   0x01, 0x02, 0xc8, 0x03, 0xf2, 0xf0, 0x03, 0x07, 0x08,
 *   0x09, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19,
 *   0x01, 0x01, 0x7b
 * ));
 *
 * console.log(info(timestamp));
 *   // msg = sha1(FILE)
 *   // msg = prepend(msg, 010203)
 *   //  -> msg = prepend(msg, 040506)
 *   //     bitcoinVerify(msg, 456)
 *   //  -> msg = reverse(msg)
 *   //     msg = append(msg, 070809)
 *   //     bitcoinVerify(msg, 123)
 * console.log(info(timestamp, true));
 *   // # version: 1
 *   // msg = sha1(FILE)
 *   //     = 0102030405060708090a0b0c0d0e0f1011121314
 *   // msg = prepend(msg, 010203)
 *   //     = 0102030102030405060708090a0b0c0d0e0f1011121314
 *   //  -> msg = prepend(msg, 040506)
 *   //         = 0405060102030102030405060708090a0b0c0d0e0f1011121314
 *   //     bitcoinVerify(msg, 456)
 *   //  -> msg = reverse(msg)
 *   //         = 14131211100f0e0d0c0b0a090807060504030201030201
 *   //     msg = append(msg, 070809)
 *   //         = 14131211100f0e0d0c0b0a090807060504030201030201070809
 *   //     bitcoinVerify(msg, 123)
 * ```
 *
 * @param timestamp - {@link Timestamp} to generate human-readable string for.
 * @param verbose - Whether to include the `value` field in the output or not.
 * @returns Human-readable string generated.
 */
export const info = _info;

/**
 * Determine whether the given {@link Timestamp} can be shrunk on the given chain.
 *
 * In order for a {@link Timestamp} to be shrunk, it needs to have at least one {@link Leaf} on the given chain, and at least one other {@link Leaf}.
 * Shrinking it would remove all but the oldest {@link Leaf} on the given chain.
 *
 * @example
 * ```typescript
 * import {canShrink, read } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(canShrink(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     0x01, 0x7b, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7,
 *     0x19, 0x01, 0x02, 0xc8, 0x03,
 *   ),
 * ), 'bitcoin'));
 *   // true
 * console.log(canShrink(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x00,
 *     0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01, 0x01,
 *     0x7b
 *   ),
 * ), 'bitcoin'));
 *   // false
 * ```
 *
 * @param timestamp - The {@link Timestamp} being queried.
 * @param chain - The chain in question.
 * @returns `true` if the given {@link Timestamp} can be shrunk on the given chain, `false` otherwise.
 */
export const canShrink = _canShrink;

/**
 * Determine whether the given {@link Timestamp} can be upgraded.
 *
 * In order for a {@link Timestamp} to be upgraded, it needs to have at least one `pending` {@link Leaf}.
 *
 * @example
 * ```typescript
 * import { canUpgrade, read } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(canUpgrade(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     0x01, 0x7b, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9,
 *     0x0c, 0x8e, 0x19, 0x18, 0x68, 0x74, 0x74, 0x70, 0x73,
 *     0x3a, 0x2f, 0x2f, 0x77, 0x77, 0x77, 0x2e, 0x65, 0x78,
 *     0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d,
 *     0x2f,
 *   ),
 * )));
 *   // true
 * console.log(canUpgrade(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     0x01, 0x7b, 0x00, 0x06, 0x86, 0x9a, 0x0d, 0x73, 0xd7,
 *     0x1b, 0x45, 0x01, 0x7b
 *   ),
 * )));
 *   // false
 * ```
 *
 * @param timestamp - The {@link Timestamp} in question.
 * @returns `true` if the given {@link Timestamp} can be upgraded, `false` otherwise.
 */
export const canUpgrade = _canUpgrade;

/**
 * Determine whether the given {@link Timestamp} can be verified.
 *
 * In order for a {@link Timestamp} to be verified, it needs to have at least one non-`pending` {@link Leaf}.
 *
 * @example
 * ```typescript
 * import { canVerify, read } from './src';
 *
 * console.log(canVerify(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     0x01, 0x7b, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9,
 *     0x0c, 0x8e, 0x19, 0x18, 0x68, 0x74, 0x74, 0x70, 0x73,
 *     0x3a, 0x2f, 0x2f, 0x77, 0x77, 0x77, 0x2e, 0x65, 0x78,
 *     0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d,
 *     0x2f
 *   ),
 * )));
 *   // true
 * console.log(canVerify(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e,
 *     0x1a, 0x19, 0x68, 0x74, 0x74, 0x70, 0x73, 0x3a, 0x2f,
 *     0x2f, 0x77, 0x77, 0x77, 0x2e, 0x65, 0x78, 0x61, 0x6d,
 *     0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x31,
 *     0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e,
 *     0x1a, 0x19, 0x68, 0x74, 0x74, 0x70, 0x73, 0x3a, 0x2f,
 *     0x2f, 0x77, 0x77, 0x77, 0x2e, 0x65, 0x78, 0x61, 0x6d,
 *     0x70, 0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d, 0x2f, 0x32
 *   ),
 * )));
 *   // false
 * ```
 *
 * @param timestamp - The {@link Timestamp} in question.
 * @returns `true` if the given {@link Timestamp} can be verified, `false` otherwise.
 */
export const canVerify = _canVerify;

/**
 * Read a {@link Timestamp} from the given data substrate.
 *
 * {@link Timestamp | Timestamps} are stored as a sequence of "parts":
 *
 * 1. A "magic header" to indicate that this is a {@link Timestamp} data stream.
 * 2. The serialization format `version`, as a `UINT`.
 * 3. The serialized {@link FileHash}.
 * 4. The serialized {@link Tree}.
 *
 * This function will read the given data stream, and return the resulting {@link Timestamp} value.
 *
 * @example
 * ```typescript
 * import { read } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73,
 *     0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f,
 *     0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
 *     1,
 *     0x02,
 *     0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
 *     0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33,
 *     0x00,
 *     0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     1,
 *     123,
 *   ),
 * ));
 *   // {
 *   //   version: 1,
 *   //   fileHash: { algorithm: 'sha1', value: Uint8Array(20) [ ... ] },
 *   //   tree: { edges: EdgeMap {}, leaves: LeafSet {} }
 *   // }
 * ```
 *
 * @example
 * ```typescript
 * import { read } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73,
 *     0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f,
 *     0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
 *     1,
 *     0x02,
 *     0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
 *     0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33,
 *     0x00,
 *     0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     1,
 *     123,
 *     4,
 *     5,
 *     6,
 *     7,
 *     8,
 *     9,
 *   ),
 * ));
 *   // Error: Garbage at EOF
 * ```
 *
 * @param data - The data substrate to use.
 * @returns The read {@link Timestamp}.
 * @throws {@link !Error} when there's additional data past the {@link Timestamp}'s value.
 */
export const read = _read;

/**
 * Shrink the given {@link Timestamp} on the given chain.
 *
 * Shrinking a {@link Timestamp} consists of eliminating all paths other than the one leading to the _oldest_ {@link Leaf} on the given chain.
 * This allows the {@link Timestamp} to be smaller, only keeping the most stringent {@link Leaf | attestation} for the chose chain.
 *
 * Note that shrinking an already shrunken {@link Timestamp} does nothing.
 *
 * @example
 * ```typescript
 * import type { Timestamp } from '@opentimestamps/typescript-opentimestamps';
 *
 * import { info, read, shrink } from '@opentimestamps/typescript-opentimestamps';
 *
 * const timestamp: Timestamp = read(
 *   Uint8Array.of(
 *     0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *     0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *     0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *     0x84, 0xe8, 0x92, 0x94, 0x01, 0x02, 0x01, 0x02, 0x03,
 *     0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
 *     0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0xff,
 *     0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
 *     0x01, 0x7b, 0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7,
 *     0x19, 0x01, 0x02, 0xc8, 0x03,
 *   ),
 * );
 *
 * console.log(info(shrink(timestamp, 'bitcoin')));
 *   // msg = sha1(FILE)
 *   // bitcoinVerify(msg, 123)
 * console.log(info(shrink(shrink(timestamp, 'bitcoin'), 'bitcoin')));
 *   // msg = sha1(FILE)
 *   // bitcoinVerify(msg, 123)
 * ```
 *
 * @param timestamp - The {@link Timestamp} to shrink.
 * @param chain - The chain to look into for shrinking.
 * @returns The shrunken {@link Timestamp}.
 */
export const shrink = _shrink;

/**
 * Submit the given value to the given list of calendars.
 *
 * This function will take an algorithm (one of `sha1`, `ripemd160`, `sha256`, or `keccak256`), and an algorithm value (either a 20- or 32-byte value), and submits said value to each of the given calendars.
 *
 * Prior to submission, a "fudge" value is hashed alongside the given one, to prevent information leakage.
 * This fudge value may be given explicitly, or it may be randomly generated if none given.
 *
 * {@link !Error | Errors} encountered upon submission are not thrown, but rather collected and returned alongside the resulting {@link Timestamp}.
 *
 * @example
 * ```typescript
 * import type { Timestamp } from '@opentimestamps/typescript-opentimestamps';
 *
 * import { info, submit } from '@opentimestamps/typescript-opentimestamps';
 *
 * const { timestamp, errors }: { timestamp: Timestamp; errors: Error[] } = await submit(
 *   'sha1',
 *   Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *   Uint8Array.of(1, 2, 3, 12, 23, 123),
 * );
 *
 * console.log(info(timestamp));
 *   // msg = sha1(FILE)
 *   // msg = append(msg, 0102030c177b)
 *   // msg = sha256(msg)
 *   //  -> msg = append(msg, 7bcfb7de87d0394c023b35e16003f936)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, a831953f37b90a9f5ebbcdee7e968622aff0c000c67c9fb8bee3eaf992959693)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, 65cb5387)
 *   //     msg = append(msg, b31df2f301366f3c)
 *   //     pendingVerify(msg, https://alice.btc.calendar.opentimestamps.org/)
 *   //  -> msg = append(msg, b7ed9e86271b179715445d568316d1d5)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, 65cb5387)
 *   //     msg = append(msg, 279f5cc8a3eea096)
 *   //     pendingVerify(msg, https://bob.btc.calendar.opentimestamps.org/)
 *   //  -> msg = append(msg, b852c30e4a6b1420c27d50a7cd40c7d2)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, c80f4d3abef43c6017ce3db34d3b7389a09ab31ae274204e12cd8babb1bafa95)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, 65cb5388)
 *   //     msg = append(msg, ddf860cef5179119)
 *   //     pendingVerify(msg, https://finney.calendar.eternitywall.com/)
 *   //  -> msg = append(msg, e71ef69c247fc026beb260bb38b01545)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, 767bc5417dca9794849f2d67c10480f6c1b715f6dfb0444b9218d36ab55d2d75)
 *   //     msg = sha256(msg)
 *   //     msg = prepend(msg, 65cb5388)
 *   //     msg = append(msg, b1d4d0b7fb122cea)
 *   //     pendingVerify(msg, https://btc.calendar.catallaxy.com/)
 * console.log(errors);
 *   // []
 * ```
 *
 * @param algorithm - The hashing algorithm to use.
 * @param value - The value to hash.
 * @param fudge - The fudging string to add (if not given, use a 16 random bytes).
 * @param calendarUrls - The calendars to submit the hashed value to, if not give, use default values.
 * @returns An object, mapping `timestamp` to the resulting {@link Timestamp | Timestamps} and `errors` to a list of {@link !Error | Errors} encountered.
 */
export const submit = _submit;

/**
 * Try to upgrade _all_ `pending` {@link Leaf | Leaves} on the given {@link Timestamp}.
 *
 * This function will try to upgrade all`pending` {@link Leaf | Leaves} on the given {@link Timestamp}, and return the resulting (potentially upgraded) {@link Timestamp}, and any {@link !Error | Errors} encountered.
 *
 * {@link !Error | Errors} encountered upon submission are not thrown, but rather collected and returned alongside the resulting {@link Timestamp}.
 *
 * @example
 * ```typescript
 * import type { Timestamp } from './src';
 *
 * import { info, read, upgrade } from './src';
 *
 * const pendingTimestamp: Timestamp = read(Uint8Array.of(
 *   0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *   0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *   0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *   0x84, 0xe8, 0x92, 0x94, 0x01, 0x08, 0x05, 0xc4, 0xf6,
 *   0x16, 0xa8, 0xe5, 0x31, 0x0d, 0x19, 0xd9, 0x38, 0xcf,
 *   0xd7, 0x69, 0x86, 0x4d, 0x7f, 0x4c, 0xcd, 0xc2, 0xca,
 *   0x8b, 0x47, 0x9b, 0x10, 0xaf, 0x83, 0x56, 0x4b, 0x09,
 *   0x7a, 0xf9, 0xf0, 0x10, 0xe7, 0x54, 0xbf, 0x93, 0x80,
 *   0x6a, 0x7e, 0xba, 0xa6, 0x80, 0xef, 0x7b, 0xd0, 0x11,
 *   0x4b, 0xf4, 0x08, 0xf0, 0x10, 0xb5, 0x73, 0xe8, 0x85,
 *   0x0c, 0xfd, 0x9e, 0x63, 0xd1, 0xf0, 0x43, 0xfb, 0xb6,
 *   0xfc, 0x25, 0x0e, 0x08, 0xf1, 0x04, 0x57, 0xcf, 0xa5,
 *   0xc4, 0xf0, 0x08, 0x6f, 0xb1, 0xac, 0x8d, 0x4e, 0x4e,
 *   0xb0, 0xe7, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9,
 *   0x0c, 0x8e, 0x2f, 0x2e, 0x68, 0x74, 0x74, 0x70, 0x73,
 *   0x3a, 0x2f, 0x2f, 0x61, 0x6c, 0x69, 0x63, 0x65, 0x2e,
 *   0x62, 0x74, 0x63, 0x2e, 0x63, 0x61, 0x6c, 0x65, 0x6e,
 *   0x64, 0x61, 0x72, 0x2e, 0x6f, 0x70, 0x65, 0x6e, 0x74,
 *   0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73,
 *   0x2e, 0x6f, 0x72, 0x67, 0x2f
 * ));
 *
 * const { timestamp, errors }: { timestamp: Timestamp; errors: Error[] } = await upgrade(pendingTimestamp);
 *
 * console.log(info(pendingTimestamp));
 *   // msg = sha256(FILE)
 *   // msg = append(msg, e754bf93806a7ebaa680ef7bd0114bf4)
 *   // msg = sha256(msg)
 *   // msg = append(msg, b573e8850cfd9e63d1f043fbb6fc250e)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 57cfa5c4)
 *   // msg = append(msg, 6fb1ac8d4e4eb0e7)
 *   // pendingVerify(msg, https://alice.btc.calendar.opentimestamps.org/)
 * console.log(info(timestamp));
 *   // msg = sha256(FILE)
 *   // msg = append(msg, e754bf93806a7ebaa680ef7bd0114bf4)
 *   // msg = sha256(msg)
 *   // msg = append(msg, b573e8850cfd9e63d1f043fbb6fc250e)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 57cfa5c4)
 *   // msg = append(msg, 6fb1ac8d4e4eb0e7)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 6563bb432a829ac8d6c54d1a9330d2240664cad8338dd05e63eec12a18a68d50)
 *   // msg = sha256(msg)
 *   // msg = append(msg, ba83ddbe2bd6772b4584b46eaed23606b712dd740a89e99e927571f77f64aa21)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 193c81e70e4472b52811fe7837ce1293b1d3542b244f27f44182af8287fc9f4e)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, c6c57696fcd39b4d992477889d04e6882829f5fe556304a281dce258b78a1f07)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 0100000001b592ca038eaa9c1b698a049b09be8ee8972b5d0eca29c19946027ba9248acb03000000004847304402200f992d5dbec6edb143f76c14e4538e0a50d66bae27c683cf4291e475287ec6af022010bae9443390aadbd2e2b8b9f757beea26d3f5c345f7e6b4d81b3d390edd381801fdffffff022eb142000000000023210338b2490eaa949538423737cd83449835d1061dca88f4ffaca7181bcac67d2095ac0000000000000000226a20)
 *   // msg = append(msg, 678a0600)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 977ac39d89bb8b879d4a2c38fca48a040c82637936707fc452c9db1390b515c8)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = append(msg, 74268b23e614997d18c7c063d8d82d7e1db57b5fc4346cc47ac2c46d54168d71)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 560c45b854f8507c8bfacf2662fef269c208a7e5df5c3145cbce417ecacc595e)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 0dba8721b9cd4ac7c2fcc7e15ba2cb9f2906bfc577c212747cd352d61b5d7fdb)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 81107a010d527d18baa874bc99c19a3a7a25dfe110a4c8985bf30f6c3e77baed)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = append(msg, ca3cdcd7093498b3f180b38a9773207e52fca992c2db1d660fdfa1b329500c39)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = append(msg, ca6c6464dd02ced64c9c82246ccfc626caa78d9e624cc11013e3b4bbc09e9891)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = append(msg, 1c7ae0feac018fa19bd8459a4ae971b3e6c816a87254317e0a9f0ec9425ba761)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 90263a73e415a975dc07706772dbb6200ef0d0a23006218e65d4a5d811206730)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // msg = prepend(msg, 79530163b0d912249438628bd791ac9402fa707eb314c6237b0ef90271625c84)
 *   // msg = sha256(msg)
 *   // msg = sha256(msg)
 *   // bitcoinVerify(msg, 428648)
 * console.log(errors);
 *   // []
 * ```
 *
 * @param timestamp - The {@link Timestamp} to upgrade.
 * @returns An object, mapping `timestamp` to the resulting {@link Timestamp}, and `errors` to a list of {@link !Error | Errors} encountered.
 */
export const upgrade = _upgrade;

/**
 * {@link Timestamp} type-predicate.
 *
 * @example
 * ```typescript
 * import { newTree, is } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(is(123));
 *   // false
 * console.log(is({}));
 *   // false
 * console.log(is({ version: 1 }));
 *   // false
 * console.log(is(
 *   {
 *     version: 1,
 *     fileHash: {
 *       algorithm: 'sha1',
 *       value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                            11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *     },
 *   },
 * ));
 *   // false
 * console.log(is(
 *   {
 *     version: 1,
 *     fileHash: {
 *       algorithm: 'sha1',
 *       value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                            11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *     },
 *     tree: newTree(),
 *   },
 * ));
 *   // true
 * ```
 *
 * @param timestamp - Datum to check.
 * @returns `true` if the given datum is indeed a {@link Timestamp}, `false` otherwise.
 * @see [Using type predicates](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
 */
export const is = _is;

/**
 * {@link Timestamp} Assertion-function.
 *
 * > This function internally calls {@link validate}.
 *
 * @example
 * ```typescript
 * import { newTree, assert } from '@opentimestamps/typescript-opentimestamps';
 *
 * assert({
 *   version: 1,
 *   fileHash: {
 *     algorithm: 'sha1',
 *     value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                          11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *   },
 *   tree: newTree(),
 * });
 *   // OK
 * ```
 *
 * @example
 * ```typescript
 * import { assert } from '@opentimestamps/typescript-opentimestamps';
 *
 * assert(123);
 *   // Error: Expected non-null object
 * assert({});
 *   // Error: Expected key .version
 * assert({ version: 1 });
 *   // Error: Expected key .fileHash
 * assert({
 *   version: 1,
 *   fileHash: {
 *     algorithm: 'sha1',
 *     value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                          11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *   },
 * });
 *   // Error: Expected key .tree
 * ```
 *
 * @param timestamp - Datum to assert.
 * @see [Assertion Functions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions)
 */
export const assert: (timestamp: unknown) => asserts timestamp is Timestamp = _assert;

/**
 * Validate that the given datum is a well-formed {@link Timestamp}.
 *
 * @example
 * ```typescript
 * import { newTree, validate } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(validate(
 *   {
 *     version: 1,
 *     fileHash: {
 *       algorithm: 'sha1',
 *       value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                            11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *     },
 *     tree: newTree(),
 *   },
 * ));
 *   // {
 *   //   version: 1,
 *   //   fileHash: { algorithm: 'sha1', value: Uint8Array(20) [  ... ] },
 *   //   tree: { edges: EdgeMap {}, leaves: LeafSet {} }
 *   // }
 * ```
 *
 * @example
 * ```typescript
 * import { validate } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(validate(123));
 *   // Error: Expected non-null object
 * console.log(validate({}));
 *   // Error: Expected key .version
 * console.log(validate({ version: 1 }));
 *   // Error: Expected key .fileHash
 * console.log(validate({
 *   version: 1,
 *   fileHash: {
 *     algorithm: 'sha1',
 *     value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                          11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *   },
 * }));
 *   // Error: Expected key .tree
 * ```
 *
 * @param timestamp - Data to validate.
 * @returns The validated {@link Timestamp}.
 * @throws {@link !Error} If the given datum has no `.version` key.
 * @throws {@link !Error} If the given datum has no `.fileHash` key.
 * @throws {@link !Error} If the given datum has no `.tree` key.
 */
export const validate = _validate;

/**
 * Write a {@link Timestamp}'s value.
 *
 * A {@link Timestamp} is written by concatenating the following parts in order:
 *
 * 1. A "magic header" to indicate that this is a {@link Timestamp} data stream.
 * 2. The `version` used to write the value.
 * 3. The {@link Timestamp}'s {@link FileHash}.
 * 4. The {@link Timestamp}'s {@link Tree}.
 *
 * @example
 * ```typescript
 * import { newTree, write } from '@opentimestamps/typescript-opentimestamps';
 *
 * console.log(write(
 *   {
 *     version: 1,
 *     fileHash: {
 *       algorithm: 'sha1',
 *       value: Uint8Array.of( 1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
 *                            11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
 *     },
 *     tree: newTree(),
 *   },
 * ));
 *   // Uint8Array(53) [
 *   //   0,  79, 112, 101, 110,  84, 105, 109, 101, 115, 116,
 *   //  97, 109, 112, 115,   0,   0,  80, 114, 111, 111, 102,
 *   //   0, 191, 137, 226, 232, 132, 232, 146, 148,   1,   2,
 *   //   1,   2,   3,   4,   5,   6,   7,   8,   9,  10,  11,
 *   //  12,  13,  14,  15,  16,  17,  18,  19,  20
 *   // ]
 * ```
 *
 * @param timestamp - The {@link Timestamp} to write.
 * @returns The written {@link !Uint8Array}.
 */
export const write = _write;

/**
 * Verify the given {@link Timestamp} with the given {@link Verifier | Verifiers}.
 *
 * This function will extract all {@link Leaf | Leaves} from the given {@link Timestamp}, run all operations leading to them, and, with the resulting message, call each {@link Verifier} given.
 *
 * {@link !Error | Errors} encountered upon submission are not thrown, but rather collected and returned alongside the result.
 *
 * @example
 * ```typescript
 * import type { Timestamp } from './src/types';
 *
 * import { read } from './src/read';
 * import { verify } from './src/verify';
 * import { default as verifiers } from './src/verifiers';
 *
 * const timestamp: Timestamp = read(Uint8Array.of(
 *   0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65,
 *   0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50,
 *   0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8,
 *   0x84, 0xe8, 0x92, 0x94, 0x01, 0x08, 0x05, 0xc4, 0xf6,
 *   0x16, 0xa8, 0xe5, 0x31, 0x0d, 0x19, 0xd9, 0x38, 0xcf,
 *   0xd7, 0x69, 0x86, 0x4d, 0x7f, 0x4c, 0xcd, 0xc2, 0xca,
 *   0x8b, 0x47, 0x9b, 0x10, 0xaf, 0x83, 0x56, 0x4b, 0x09,
 *   0x7a, 0xf9, 0xf0, 0x10, 0xe7, 0x54, 0xbf, 0x93, 0x80,
 *   0x6a, 0x7e, 0xba, 0xa6, 0x80, 0xef, 0x7b, 0xd0, 0x11,
 *   0x4b, 0xf4, 0x08, 0xf0, 0x10, 0xb5, 0x73, 0xe8, 0x85,
 *   0x0c, 0xfd, 0x9e, 0x63, 0xd1, 0xf0, 0x43, 0xfb, 0xb6,
 *   0xfc, 0x25, 0x0e, 0x08, 0xf1, 0x04, 0x57, 0xcf, 0xa5,
 *   0xc4, 0xf0, 0x08, 0x6f, 0xb1, 0xac, 0x8d, 0x4e, 0x4e,
 *   0xb0, 0xe7, 0x08, 0xf1, 0x20, 0x65, 0x63, 0xbb, 0x43,
 *   0x2a, 0x82, 0x9a, 0xc8, 0xd6, 0xc5, 0x4d, 0x1a, 0x93,
 *   0x30, 0xd2, 0x24, 0x06, 0x64, 0xca, 0xd8, 0x33, 0x8d,
 *   0xd0, 0x5e, 0x63, 0xee, 0xc1, 0x2a, 0x18, 0xa6, 0x8d,
 *   0x50, 0x08, 0xf0, 0x20, 0xba, 0x83, 0xdd, 0xbe, 0x2b,
 *   0xd6, 0x77, 0x2b, 0x45, 0x84, 0xb4, 0x6e, 0xae, 0xd2,
 *   0x36, 0x06, 0xb7, 0x12, 0xdd, 0x74, 0x0a, 0x89, 0xe9,
 *   0x9e, 0x92, 0x75, 0x71, 0xf7, 0x7f, 0x64, 0xaa, 0x21,
 *   0x08, 0xf1, 0x20, 0x19, 0x3c, 0x81, 0xe7, 0x0e, 0x44,
 *   0x72, 0xb5, 0x28, 0x11, 0xfe, 0x78, 0x37, 0xce, 0x12,
 *   0x93, 0xb1, 0xd3, 0x54, 0x2b, 0x24, 0x4f, 0x27, 0xf4,
 *   0x41, 0x82, 0xaf, 0x82, 0x87, 0xfc, 0x9f, 0x4e, 0x08,
 *   0xf1, 0x20, 0xc6, 0xc5, 0x76, 0x96, 0xfc, 0xd3, 0x9b,
 *   0x4d, 0x99, 0x24, 0x77, 0x88, 0x9d, 0x04, 0xe6, 0x88,
 *   0x28, 0x29, 0xf5, 0xfe, 0x55, 0x63, 0x04, 0xa2, 0x81,
 *   0xdc, 0xe2, 0x58, 0xb7, 0x8a, 0x1f, 0x07, 0x08, 0xf1,
 *   0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0xb5, 0x92,
 *   0xca, 0x03, 0x8e, 0xaa, 0x9c, 0x1b, 0x69, 0x8a, 0x04,
 *   0x9b, 0x09, 0xbe, 0x8e, 0xe8, 0x97, 0x2b, 0x5d, 0x0e,
 *   0xca, 0x29, 0xc1, 0x99, 0x46, 0x02, 0x7b, 0xa9, 0x24,
 *   0x8a, 0xcb, 0x03, 0x00, 0x00, 0x00, 0x00, 0x48, 0x47,
 *   0x30, 0x44, 0x02, 0x20, 0x0f, 0x99, 0x2d, 0x5d, 0xbe,
 *   0xc6, 0xed, 0xb1, 0x43, 0xf7, 0x6c, 0x14, 0xe4, 0x53,
 *   0x8e, 0x0a, 0x50, 0xd6, 0x6b, 0xae, 0x27, 0xc6, 0x83,
 *   0xcf, 0x42, 0x91, 0xe4, 0x75, 0x28, 0x7e, 0xc6, 0xaf,
 *   0x02, 0x20, 0x10, 0xba, 0xe9, 0x44, 0x33, 0x90, 0xaa,
 *   0xdb, 0xd2, 0xe2, 0xb8, 0xb9, 0xf7, 0x57, 0xbe, 0xea,
 *   0x26, 0xd3, 0xf5, 0xc3, 0x45, 0xf7, 0xe6, 0xb4, 0xd8,
 *   0x1b, 0x3d, 0x39, 0x0e, 0xdd, 0x38, 0x18, 0x01, 0xfd,
 *   0xff, 0xff, 0xff, 0x02, 0x2e, 0xb1, 0x42, 0x00, 0x00,
 *   0x00, 0x00, 0x00, 0x23, 0x21, 0x03, 0x38, 0xb2, 0x49,
 *   0x0e, 0xaa, 0x94, 0x95, 0x38, 0x42, 0x37, 0x37, 0xcd,
 *   0x83, 0x44, 0x98, 0x35, 0xd1, 0x06, 0x1d, 0xca, 0x88,
 *   0xf4, 0xff, 0xac, 0xa7, 0x18, 0x1b, 0xca, 0xc6, 0x7d,
 *   0x20, 0x95, 0xac, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
 *   0x00, 0x00, 0x22, 0x6a, 0x20, 0xf0, 0x04, 0x67, 0x8a,
 *   0x06, 0x00, 0x08, 0x08, 0xf1, 0x20, 0x97, 0x7a, 0xc3,
 *   0x9d, 0x89, 0xbb, 0x8b, 0x87, 0x9d, 0x4a, 0x2c, 0x38,
 *   0xfc, 0xa4, 0x8a, 0x04, 0x0c, 0x82, 0x63, 0x79, 0x36,
 *   0x70, 0x7f, 0xc4, 0x52, 0xc9, 0xdb, 0x13, 0x90, 0xb5,
 *   0x15, 0xc8, 0x08, 0x08, 0xf0, 0x20, 0x74, 0x26, 0x8b,
 *   0x23, 0xe6, 0x14, 0x99, 0x7d, 0x18, 0xc7, 0xc0, 0x63,
 *   0xd8, 0xd8, 0x2d, 0x7e, 0x1d, 0xb5, 0x7b, 0x5f, 0xc4,
 *   0x34, 0x6c, 0xc4, 0x7a, 0xc2, 0xc4, 0x6d, 0x54, 0x16,
 *   0x8d, 0x71, 0x08, 0x08, 0xf1, 0x20, 0x56, 0x0c, 0x45,
 *   0xb8, 0x54, 0xf8, 0x50, 0x7c, 0x8b, 0xfa, 0xcf, 0x26,
 *   0x62, 0xfe, 0xf2, 0x69, 0xc2, 0x08, 0xa7, 0xe5, 0xdf,
 *   0x5c, 0x31, 0x45, 0xcb, 0xce, 0x41, 0x7e, 0xca, 0xcc,
 *   0x59, 0x5e, 0x08, 0x08, 0xf1, 0x20, 0x0d, 0xba, 0x87,
 *   0x21, 0xb9, 0xcd, 0x4a, 0xc7, 0xc2, 0xfc, 0xc7, 0xe1,
 *   0x5b, 0xa2, 0xcb, 0x9f, 0x29, 0x06, 0xbf, 0xc5, 0x77,
 *   0xc2, 0x12, 0x74, 0x7c, 0xd3, 0x52, 0xd6, 0x1b, 0x5d,
 *   0x7f, 0xdb, 0x08, 0x08, 0xf1, 0x20, 0x81, 0x10, 0x7a,
 *   0x01, 0x0d, 0x52, 0x7d, 0x18, 0xba, 0xa8, 0x74, 0xbc,
 *   0x99, 0xc1, 0x9a, 0x3a, 0x7a, 0x25, 0xdf, 0xe1, 0x10,
 *   0xa4, 0xc8, 0x98, 0x5b, 0xf3, 0x0f, 0x6c, 0x3e, 0x77,
 *   0xba, 0xed, 0x08, 0x08, 0xf0, 0x20, 0xca, 0x3c, 0xdc,
 *   0xd7, 0x09, 0x34, 0x98, 0xb3, 0xf1, 0x80, 0xb3, 0x8a,
 *   0x97, 0x73, 0x20, 0x7e, 0x52, 0xfc, 0xa9, 0x92, 0xc2,
 *   0xdb, 0x1d, 0x66, 0x0f, 0xdf, 0xa1, 0xb3, 0x29, 0x50,
 *   0x0c, 0x39, 0x08, 0x08, 0xf0, 0x20, 0xca, 0x6c, 0x64,
 *   0x64, 0xdd, 0x02, 0xce, 0xd6, 0x4c, 0x9c, 0x82, 0x24,
 *   0x6c, 0xcf, 0xc6, 0x26, 0xca, 0xa7, 0x8d, 0x9e, 0x62,
 *   0x4c, 0xc1, 0x10, 0x13, 0xe3, 0xb4, 0xbb, 0xc0, 0x9e,
 *   0x98, 0x91, 0x08, 0x08, 0xf0, 0x20, 0x1c, 0x7a, 0xe0,
 *   0xfe, 0xac, 0x01, 0x8f, 0xa1, 0x9b, 0xd8, 0x45, 0x9a,
 *   0x4a, 0xe9, 0x71, 0xb3, 0xe6, 0xc8, 0x16, 0xa8, 0x72,
 *   0x54, 0x31, 0x7e, 0x0a, 0x9f, 0x0e, 0xc9, 0x42, 0x5b,
 *   0xa7, 0x61, 0x08, 0x08, 0xf1, 0x20, 0x90, 0x26, 0x3a,
 *   0x73, 0xe4, 0x15, 0xa9, 0x75, 0xdc, 0x07, 0x70, 0x67,
 *   0x72, 0xdb, 0xb6, 0x20, 0x0e, 0xf0, 0xd0, 0xa2, 0x30,
 *   0x06, 0x21, 0x8e, 0x65, 0xd4, 0xa5, 0xd8, 0x11, 0x20,
 *   0x67, 0x30, 0x08, 0x08, 0xf1, 0x20, 0x79, 0x53, 0x01,
 *   0x63, 0xb0, 0xd9, 0x12, 0x24, 0x94, 0x38, 0x62, 0x8b,
 *   0xd7, 0x91, 0xac, 0x94, 0x02, 0xfa, 0x70, 0x7e, 0xb3,
 *   0x14, 0xc6, 0x23, 0x7b, 0x0e, 0xf9, 0x02, 0x71, 0x62,
 *   0x5c, 0x84, 0x08, 0x08, 0x00, 0x05, 0x88, 0x96, 0x0d,
 *   0x73, 0xd7, 0x19, 0x01, 0x03, 0xe8, 0x94, 0x1a,
 * ));
 *
 * console.log(await verify(timestamp, verifiers));
 *   // {
 *   //   attestations: {
 *   //     '1473227803': [ 'verifyViaBlockchainInfo', 'verifyViaBlockstream' ]
 *   //   },
 *   //   errors: {}
 *   // }
 * ```
 *
 * @param timestamp - The {@link Timestamp} to verify.
 * @param verifiers - An object, mapping a name to a {@link Verifier} proper to utilize.
 * @returns An object, mapping `attestations` to an object in turn mapping a UNIX timestamp to a list of verifier names verifying the existence of the {@link Timestamp} at said height; and mapping `errors` to an object in turn mapping a verifier name to a list of {@link !Error | Errors} encountered.
 */
export const verify = _verify;

/**
 * A mapping from {@link Verifier} name to their actual implementation, suitable for usage with {@link verify}.
 *
 */
export const verifiers = _verifiers;
