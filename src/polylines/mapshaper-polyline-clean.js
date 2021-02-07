import { NodeCollection } from '../topology/mapshaper-nodes';
import { getArcPresenceTest } from '../paths/mapshaper-path-utils';
import { forEachShapePart } from '../paths/mapshaper-shape-utils';
import { IdLookupIndex } from '../indexing/mapshaper-id-lookup-index';
import { reversePath } from '../paths/mapshaper-path-utils';
import { error } from '../utils/mapshaper-logging';

// Assumes intersection cuts have been added and duplicated points removed
// TODO: consider closing undershoots (see mapshaper-undershoots.js)
export function cleanPolylineLayerGeometry(lyr, dataset, opts) {
  var arcs = dataset.arcs;
  var filter = getArcPresenceTest(lyr.shapes, arcs);
  var nodes = new NodeCollection(arcs, filter);
  var endpointIndex = new IdLookupIndex(arcs.size(), true);
  lyr.shapes = lyr.shapes.map(function(shp, i) {
    if (!shp) return null;
    shp = divideShapeAtNodes(shp, nodes);
    // try to combine parts that form a contiguous line
    // (some datasets may use a separate part for each segment)
    return combineContiguousParts(shp, nodes, endpointIndex);
  });
}

function divideShapeAtNodes(shp, nodes) {
  var shape = [];
  forEachShapePart(shp, onPart);
  return shape;

  function onPart(ids) {
    var n = ids.length;
    var id, connected;
    var ids2 = [];
    for (var i=0; i<n; i++) {
      // check each segment of the current part (equivalent to a LineString)
      id = ids[i];
      ids2.push(id);
      if (i < n-1 && nodes.getConnectedArcs(id).length > 1) {
        // divide the current part if the front endpoint of the current segment
        // touches any other segment than the next segment in this part
        // TODO: consider not dividing if the intersection does not involve
        // the current feature (ie. it is not a self-intersection).
        // console.log('connections:', nodes.getConnectedArcs(id))
        shape.push(ids2);
        ids2 = [];
      }
    }
    if (ids2.length > 0) shape.push(ids2);
  }
}

function combineContiguousParts(parts, nodes, endpointIndex) {
  if (parts.length < 2) return parts;

  // Index the terminal arcs of this group of polyline parts
  parts.forEach(function(ids, i) {
    var tailId = ~ids[0]; // index the reversed arc (so it points outwards)
    var headId = ids[ids.length - 1];
    endpointIndex.setId(tailId, i);
    endpointIndex.setId(headId, i);
  });

  // combine parts that can be merged without changing feature topology
  parts.forEach(function(ids, i) {
    var tailId = ~ids[0];
    var headId = ids[ids.length - 1];
    procEndpoint(tailId, i);
    procEndpoint(headId, i);
  });

  endpointIndex.clear(); // clear the index so it can be re-used
  return parts.filter(function(ids) { return !!ids; });

  function procEndpoint(endpointId, sourcePartId) {
    var joins = 0;
    var endpointId2, partId2;
    var indexedPartId = endpointIndex.getId(endpointId);
    nodes.forEachConnectedArc(endpointId, function(arcId) {
      if (!endpointIndex.hasId(arcId)) return;
      partId2 = endpointIndex.getId(arcId);
      endpointId2 = arcId;
      joins++;
    });
    if (joins == 1 && sourcePartId > partId2) {
      extendPolylinePart(parts, partId2, endpointId2, indexedPartId, endpointId);
      // update indexed part id of joining endpoint
      endpointIndex.setId(endpointId, partId2);
      // update indexed part id of other endpoint
      var ids = parts[indexedPartId];
      var otherEndpointId = getOtherEndpointId(ids, endpointId);
      endpointIndex.setId(otherEndpointId, partId2);
      parts[indexedPartId] = null;
    }
  }
}

function getOtherEndpointId(ids, endpointId) {
  var headId = ~ids[0];
  var tailId = ids[ids.length-1];
  if (endpointId == headId) return tailId;
  else if (endpointId == tailId) return headId;
  error('Indexing error');
}

export function extendPolylinePart(parts, partId1, endpoint1, partId2, endpoint2) {
  var ids1 = parts[partId1];
  var ids2 = parts[partId2];
  var joinToTail, joinFromTail;
  if (~endpoint1 == ids1[0]) {
    joinToTail = true;
  } else if (endpoint1 == ids1[ids1.length-1]) {
    joinToTail = false;
  } else {
    error('Index error');
  }
  if (~endpoint2 == ids2[0]) {
    joinFromTail = true;
  } else if (endpoint2 == ids2[ids2.length-1]) {
    joinFromTail = false;
  } else {
    error('Index error 2');
  }
  if (!joinFromTail) {
    ids2 = reversePath(ids2.concat());
  }
  if (joinToTail) {
    prependPath(ids1, ids2);
  } else {
    appendPath(ids1, ids2);
  }
}

function prependPath(target, source) {
  source = reversePath(source.concat());
  var args = [0, 0].concat(source);
  target.splice.apply(target, args);
}

function appendPath(target, source) {
  target.push.apply(target, source);
}