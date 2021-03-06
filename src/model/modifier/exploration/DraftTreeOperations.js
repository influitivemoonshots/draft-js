/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @format
 * @flow strict-local
 * @emails oncall+draft_js
 *
 * This is unstable and not part of the public API and should not be used by
 * production systems. This file may be update/removed without notice.
 */
import type {BlockMap} from 'BlockMap';

const ContentBlockNode = require('ContentBlockNode');
const DraftTreeInvariants = require('DraftTreeInvariants');

const generateRandomKey = require('generateRandomKey');
const Immutable = require('immutable');
const invariant = require('invariant');

type SiblingInsertPosition = 'previous' | 'next';

const verifyTree = (tree: BlockMap): void => {
  if (__DEV__) {
    invariant(DraftTreeInvariants.isValidTree(tree), 'The tree is not valid');
  }
};

/**
 * This is a utility method for setting B as a child of A, ensuring
 * that parent <-> child operations are correctly mirrored
 *
 * The child is inserted at 'position' index in the list
 *
 * The block map returned by this method may not be a valid tree (siblings are
 * unaffected)
 */
const updateParentChild = (
  blockMap: BlockMap,
  parentKey: string,
  childKey: string,
  position: number,
): BlockMap => {
  const parent = blockMap.get(parentKey);
  const child = blockMap.get(childKey);
  invariant(
    parent != null && child != null,
    'parent & child should exist in the block map',
  );
  const newBlocks = {};
  const existingChildren = parent.getChildKeys();
  invariant(
    existingChildren != null &&
      position >= 0 &&
      position <= existingChildren.count(),
    'position is not valid for the number of children',
  );

  // add as parent's child
  newBlocks[parentKey] = parent.merge({
    children: existingChildren.splice(position, 0, childKey),
  });

  let nextSiblingKey = null;
  let prevSiblingKey = null;
  // link new child as next sibling to the correct existing child
  if (position > 0) {
    prevSiblingKey = existingChildren.get(position - 1);
    newBlocks[prevSiblingKey] = blockMap.get(prevSiblingKey).merge({
      nextSibling: childKey,
    });
  }
  // link new child as previous sibling to the correct existing child
  if (position < existingChildren.count()) {
    nextSiblingKey = existingChildren.get(position);
    newBlocks[nextSiblingKey] = blockMap.get(nextSiblingKey).merge({
      prevSibling: childKey,
    });
  }
  // add parent & siblings to the child
  newBlocks[childKey] = child.merge({
    parent: parentKey,
    prevSibling: prevSiblingKey,
    nextSibling: nextSiblingKey,
  });
  return blockMap.merge(newBlocks);
};

/**
 * This is a utility method for setting B as the next sibling of A, ensuring
 * that sibling operations are correctly mirrored
 *
 * The block map returned by this method may not be a valid tree (parent/child/
 * other siblings are unaffected)
 */
const updateSibling = (
  blockMap: BlockMap,
  prevKey: string,
  nextKey: string,
): BlockMap => {
  const prevSibling = blockMap.get(prevKey);
  const nextSibling = blockMap.get(nextKey);
  invariant(
    prevSibling != null && nextSibling != null,
    'siblings should exist in the block map',
  );
  const newBlocks = {};
  newBlocks[prevKey] = prevSibling.merge({
    nextSibling: nextKey,
  });
  newBlocks[nextKey] = nextSibling.merge({
    prevSibling: prevKey,
  });
  return blockMap.merge(newBlocks);
};

/**
 * This is a utility method for replacing B by C as a child of A, ensuring
 * that parent <-> child connections between A & C are correctly mirrored
 *
 * The block map returned by this method may not be a valid tree (siblings are
 * unaffected)
 */
const replaceParentChild = (
  blockMap: BlockMap,
  parentKey: string,
  existingChildKey: string,
  newChildKey: string,
): BlockMap => {
  const parent = blockMap.get(parentKey);
  const newChild = blockMap.get(newChildKey);
  invariant(
    parent != null && newChild != null,
    'parent & child should exist in the block map',
  );
  const existingChildren = parent.getChildKeys();
  const newBlocks = {};
  newBlocks[parentKey] = parent.merge({
    children: existingChildren.set(
      existingChildren.indexOf(existingChildKey),
      newChildKey,
    ),
  });
  newBlocks[newChildKey] = newChild.merge({
    parent: parentKey,
  });
  return blockMap.merge(newBlocks);
};

/**
 * This is a utility method that abstracts the operation of creating a new parent
 * for a particular node in the block map.
 *
 * This operation respects the tree data invariants - it expects and returns a
 * valid tree.
 */
const createNewParent = (blockMap: BlockMap, key: string): BlockMap => {
  verifyTree(blockMap);
  const block = blockMap.get(key);
  invariant(block != null, 'block must exist in block map');
  const newParent = new ContentBlockNode({
    key: generateRandomKey(),
    text: '',
    depth: block.depth,
    type: block.type,
    children: Immutable.List([]),
  });
  // add the parent just before the child in the block map
  let newBlockMap = blockMap
    .takeUntil(block => block.getKey() === key)
    .concat(Immutable.OrderedMap([[newParent.getKey(), newParent]]))
    .concat(blockMap.skipUntil(block => block.getKey() === key));
  // set parent <-> child connection
  newBlockMap = updateParentChild(newBlockMap, newParent.getKey(), key, 0);
  // set siblings & parent for the new parent key to child's siblings & parent
  const prevSibling = block.getPrevSiblingKey();
  const nextSibling = block.getNextSiblingKey();
  const parent = block.getParentKey();
  if (prevSibling != null) {
    newBlockMap = updateSibling(newBlockMap, prevSibling, newParent.getKey());
  }
  if (nextSibling != null) {
    newBlockMap = updateSibling(newBlockMap, newParent.getKey(), nextSibling);
  }
  if (parent != null) {
    newBlockMap = replaceParentChild(
      newBlockMap,
      parent,
      key,
      newParent.getKey(),
    );
  }
  verifyTree(newBlockMap);
  return newBlockMap;
};

/**
 * This is a utility method that abstracts the operation of adding a node as the child
 * of its previous or next sibling.
 *
 * The previous (or next) sibling must be a valid parent node.
 *
 * This operation respects the tree data invariants - it expects and returns a
 * valid tree.
 */
const updateAsSiblingsChild = (
  blockMap: BlockMap,
  key: string,
  position: SiblingInsertPosition,
): BlockMap => {
  verifyTree(blockMap);
  const block = blockMap.get(key);
  invariant(block != null, 'block must exist in block map');
  const newParentKey =
    position === 'previous'
      ? block.getPrevSiblingKey()
      : block.getNextSiblingKey();
  invariant(newParentKey != null, 'sibling is null');
  const newParent = blockMap.get(newParentKey);
  invariant(
    newParent !== null && newParent.getText() === '',
    'parent must be a valid node',
  );
  let newBlockMap = blockMap;
  switch (position) {
    case 'next':
      newBlockMap = updateParentChild(newBlockMap, newParentKey, key, 0);
      const prevSibling = block.getPrevSiblingKey();
      if (prevSibling != null) {
        newBlockMap = updateSibling(newBlockMap, prevSibling, newParentKey);
      } else {
        newBlockMap = newBlockMap.set(
          newParentKey,
          newBlockMap.get(newParentKey).merge({prevSibling: null}),
        );
      }
      // we also need to flip the order of the sibling & block in the ordered map
      // for this case
      newBlockMap = newBlockMap
        .takeUntil(block => block.getKey() === key)
        .concat(
          Immutable.OrderedMap([
            [newParentKey, newBlockMap.get(newParentKey)],
            [key, newBlockMap.get(key)],
          ]),
        )
        .concat(
          newBlockMap
            .skipUntil(block => block.getKey() === newParentKey)
            .slice(1),
        );
      break;
    case 'previous':
      newBlockMap = updateParentChild(
        newBlockMap,
        newParentKey,
        key,
        newParent.getChildKeys().count(),
      );
      const nextSibling = block.getNextSiblingKey();
      if (nextSibling != null) {
        newBlockMap = updateSibling(newBlockMap, newParentKey, nextSibling);
      } else {
        newBlockMap = newBlockMap.set(
          newParentKey,
          newBlockMap.get(newParentKey).merge({nextSibling: null}),
        );
      }
      break;
  }
  // remove the node as a child of its current parent
  const parentKey = block.getParentKey();
  if (parentKey != null) {
    const parent = newBlockMap.get(parentKey);
    newBlockMap = newBlockMap.set(
      parentKey,
      parent.merge({
        children: parent
          .getChildKeys()
          .delete(parent.getChildKeys().indexOf(key)),
      }),
    );
  }
  verifyTree(newBlockMap);
  return newBlockMap;
};

module.exports = {
  updateParentChild,
  replaceParentChild,
  updateSibling,
  createNewParent,
  updateAsSiblingsChild,
};
