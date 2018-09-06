'use strict';

var ContentBlockNode = require('./ContentBlockNode'); /**
                                                       * Copyright (c) 2013-present, Facebook, Inc.
                                                       * All rights reserved.
                                                       *
                                                       * This source code is licensed under the BSD-style license found in the
                                                       * LICENSE file in the root directory of this source tree. An additional grant
                                                       * of patent rights can be found in the PATENTS file in the same directory.
                                                       *
                                                       * @format
                                                       *  strict-local
                                                       * @emails oncall+draft_js
                                                       *
                                                       * This is unstable and not part of the public API and should not be used by
                                                       * production systems. This file may be update/removed without notice.
                                                       */

var DraftTreeInvariants = require('./DraftTreeInvariants');

var generateRandomKey = require('./generateRandomKey');
var Immutable = require('immutable');
var invariant = require('fbjs/lib/invariant');

var verifyTree = function verifyTree(tree) {
  if (process.env.NODE_ENV !== 'production') {
    !DraftTreeInvariants.isValidTree(tree) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'The tree is not valid') : invariant(false) : void 0;
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
var updateParentChild = function updateParentChild(blockMap, parentKey, childKey, position) {
  var parent = blockMap.get(parentKey);
  var child = blockMap.get(childKey);
  !(parent != null && child != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'parent & child should exist in the block map') : invariant(false) : void 0;
  var newBlocks = {};
  var existingChildren = parent.getChildKeys();
  !(existingChildren != null && position >= 0 && position <= existingChildren.count()) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'position is not valid for the number of children') : invariant(false) : void 0;

  // add as parent's child
  newBlocks[parentKey] = parent.merge({
    children: existingChildren.splice(position, 0, childKey)
  });

  var nextSiblingKey = null;
  var prevSiblingKey = null;
  // link new child as next sibling to the correct existing child
  if (position > 0) {
    prevSiblingKey = existingChildren.get(position - 1);
    newBlocks[prevSiblingKey] = blockMap.get(prevSiblingKey).merge({
      nextSibling: childKey
    });
  }
  // link new child as previous sibling to the correct existing child
  if (position < existingChildren.count()) {
    nextSiblingKey = existingChildren.get(position);
    newBlocks[nextSiblingKey] = blockMap.get(nextSiblingKey).merge({
      prevSibling: childKey
    });
  }
  // add parent & siblings to the child
  newBlocks[childKey] = child.merge({
    parent: parentKey,
    prevSibling: prevSiblingKey,
    nextSibling: nextSiblingKey
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
var updateSibling = function updateSibling(blockMap, prevKey, nextKey) {
  var prevSibling = blockMap.get(prevKey);
  var nextSibling = blockMap.get(nextKey);
  !(prevSibling != null && nextSibling != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'siblings should exist in the block map') : invariant(false) : void 0;
  var newBlocks = {};
  newBlocks[prevKey] = prevSibling.merge({
    nextSibling: nextKey
  });
  newBlocks[nextKey] = nextSibling.merge({
    prevSibling: prevKey
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
var replaceParentChild = function replaceParentChild(blockMap, parentKey, existingChildKey, newChildKey) {
  var parent = blockMap.get(parentKey);
  var newChild = blockMap.get(newChildKey);
  !(parent != null && newChild != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'parent & child should exist in the block map') : invariant(false) : void 0;
  var existingChildren = parent.getChildKeys();
  var newBlocks = {};
  newBlocks[parentKey] = parent.merge({
    children: existingChildren.set(existingChildren.indexOf(existingChildKey), newChildKey)
  });
  newBlocks[newChildKey] = newChild.merge({
    parent: parentKey
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
var createNewParent = function createNewParent(blockMap, key) {
  verifyTree(blockMap);
  var block = blockMap.get(key);
  !(block != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'block must exist in block map') : invariant(false) : void 0;
  var newParent = new ContentBlockNode({
    key: generateRandomKey(),
    text: '',
    depth: block.depth,
    type: block.type,
    children: Immutable.List([])
  });
  // add the parent just before the child in the block map
  var newBlockMap = blockMap.takeUntil(function (block) {
    return block.getKey() === key;
  }).concat(Immutable.OrderedMap([[newParent.getKey(), newParent]])).concat(blockMap.skipUntil(function (block) {
    return block.getKey() === key;
  }));
  // set parent <-> child connection
  newBlockMap = updateParentChild(newBlockMap, newParent.getKey(), key, 0);
  // set siblings & parent for the new parent key to child's siblings & parent
  var prevSibling = block.getPrevSiblingKey();
  var nextSibling = block.getNextSiblingKey();
  var parent = block.getParentKey();
  if (prevSibling != null) {
    newBlockMap = updateSibling(newBlockMap, prevSibling, newParent.getKey());
  }
  if (nextSibling != null) {
    newBlockMap = updateSibling(newBlockMap, newParent.getKey(), nextSibling);
  }
  if (parent != null) {
    newBlockMap = replaceParentChild(newBlockMap, parent, key, newParent.getKey());
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
var updateAsSiblingsChild = function updateAsSiblingsChild(blockMap, key, position) {
  verifyTree(blockMap);
  var block = blockMap.get(key);
  !(block != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'block must exist in block map') : invariant(false) : void 0;
  var newParentKey = position === 'previous' ? block.getPrevSiblingKey() : block.getNextSiblingKey();
  !(newParentKey != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'sibling is null') : invariant(false) : void 0;
  var newParent = blockMap.get(newParentKey);
  !(newParent !== null && newParent.getText() === '') ? process.env.NODE_ENV !== 'production' ? invariant(false, 'parent must be a valid node') : invariant(false) : void 0;
  var newBlockMap = blockMap;
  switch (position) {
    case 'next':
      newBlockMap = updateParentChild(newBlockMap, newParentKey, key, 0);
      var prevSibling = block.getPrevSiblingKey();
      if (prevSibling != null) {
        newBlockMap = updateSibling(newBlockMap, prevSibling, newParentKey);
      } else {
        newBlockMap = newBlockMap.set(newParentKey, newBlockMap.get(newParentKey).merge({ prevSibling: null }));
      }
      // we also need to flip the order of the sibling & block in the ordered map
      // for this case
      newBlockMap = newBlockMap.takeUntil(function (block) {
        return block.getKey() === key;
      }).concat(Immutable.OrderedMap([[newParentKey, newBlockMap.get(newParentKey)], [key, newBlockMap.get(key)]])).concat(newBlockMap.skipUntil(function (block) {
        return block.getKey() === newParentKey;
      }).slice(1));
      break;
    case 'previous':
      newBlockMap = updateParentChild(newBlockMap, newParentKey, key, newParent.getChildKeys().count());
      var nextSibling = block.getNextSiblingKey();
      if (nextSibling != null) {
        newBlockMap = updateSibling(newBlockMap, newParentKey, nextSibling);
      } else {
        newBlockMap = newBlockMap.set(newParentKey, newBlockMap.get(newParentKey).merge({ nextSibling: null }));
      }
      break;
  }
  // remove the node as a child of its current parent
  var parentKey = block.getParentKey();
  if (parentKey != null) {
    var parent = newBlockMap.get(parentKey);
    newBlockMap = newBlockMap.set(parentKey, parent.merge({
      children: parent.getChildKeys()['delete'](parent.getChildKeys().indexOf(key))
    }));
  }
  verifyTree(newBlockMap);
  return newBlockMap;
};

module.exports = {
  updateParentChild: updateParentChild,
  replaceParentChild: replaceParentChild,
  updateSibling: updateSibling,
  createNewParent: createNewParent,
  updateAsSiblingsChild: updateAsSiblingsChild
};