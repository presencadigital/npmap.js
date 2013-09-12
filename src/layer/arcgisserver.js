/* global L */

'use strict';

var json3 = require('json3'),
    reqwest = require('reqwest'),
    util = require('../util/util');

var ArcGisServerLayer = L.TileLayer.extend({
  options: {
    errorTileUrl: L.Util.emptyImageUrl
  },
  statics: {
    TILED_TEMPLATE: '{{url}}/tile/{z}/{y}/{x}'
  },
  /**
   * Handles a  click operation for this layer.
   * @param {Object} e
   */
  _handleClick: function(e) {
    var latLng = e.latlng,
        me = this;

    this.identify(latLng, function(response) {
      if (response.results && response.results.length) {
        var html = '<table><tbody>',
            popup = L.popup();

        for (var i = 0; i < response.results.length; i++) {
          html += '<tr><td>' + response.results[i].value + '</td></tr>';
        }

        popup.setContent('<div class="title">Information</div><div class="npmap-overflow">' + html + '</tbody></table></div>').setLatLng(latLng).openOn(me._map);
      }
    });
  },
  /**
   * Removes the layer's attribution string from the attribution control.
   */
  _removeAttribution: function() {
    if (this.options.attribution) {
      this._map.attributionControl.removeAttribution(this.options.attribution);
    }
  },
  /**
   * Converts a Leaflet bounds to an Esri bounds.
   * @param {Object} bounds
   * @return {Object}
   */
  _toEsriBounds: function(bounds) {
    return {
      spatalReference: {
        wkid: 4326
      },
      xmax: bounds.getNorthEast().lng,
      ymax: bounds.getNorthEast().lat,
      xmin: bounds.getSouthWest().lng,
      ymin: bounds.getSouthWest().lat
    };
  },
  /** 
   * Updates the layer's attribution string from the "dynamic attribution" object.
   */
  _updateAttribution: function() {
    var map = this._map,
        bounds = map.getBounds(),
        include = [],
        zoom = map.getZoom();

    this._removeAttribution();

    for (var i = 0; i < this._dynamicAttributionData.length; i++) {
      var contributor = this._dynamicAttributionData[i];

      for (var j = 0; j < contributor.coverageAreas.length; j++) {
        var coverageArea = contributor.coverageAreas[j],
            coverageBounds = coverageArea.bbox;

        if (zoom >= coverageArea.zoomMin && zoom <= coverageArea.zoomMax) {
          if (bounds.intersects(L.latLngBounds(L.latLng(coverageBounds[0], coverageBounds[3]), L.latLng(coverageBounds[2], coverageBounds[1])))) {
            include.push(contributor.attribution);
            break;
          }
        }
      }
    }

    if (include.length) {
      this.options.attribution = include.join(', ');
      map.attributionControl.addAttribution(this.options.attribution);
    }
  },
  /**
   * Perform an identify operation on this layer.
   * @param {Object} latLng
   * @param {Function} callback
   */
  identify: function(latLng, callback) {
    var container = this._map.getContainer(),
      params = {
        f: 'json',
        geometry: json3.stringify({
          spatialReference: {
            wkid: 4265
          },
          x: latLng.lng,
          y: latLng.lat
        }),
        geometryType: 'esriGeometryPoint',
        imageDisplay: container.offsetWidth + ',' + container.offsetHeight + ',96',
        mapExtent: json3.stringify(this._toEsriBounds(this._map.getBounds())),
        returnGeometry: false,
        sr: '4265',
        tolerance: 3
      };

    if (this._layers) {
      params.layers = this._layers;
    }

    reqwest({
      data: params,
      success: function(response) {
        if (callback) {
          callback(response);
        }
      },
      type: 'jsonp',
      url: this.options.url + '/identify'
    });
  },
  /**
   * Initializes the layer. Called by the layer constructor.
   * @param {Object} config
   * @return {Object}
   */
  initialize: function(config) {
    var me = this;

    util.strict(config.tiled, 'boolean');
    util.strict(config.url, 'string');

    if (config.layers) {
      this._layers = config.layers;
    }

    if (config.tiled) {
      var u;

      if (config.url.indexOf('{s}') === -1 && config.url.indexOf('://tiles.arcgis.com')) {
        config.subdomains = [
          '1',
          '2',
          '3',
          '4'
        ];
        u = config.url.replace('://tiles.arcgis.com', '://tiles{s}.arcgis.com');
      } else {
        u = config.url;
      }

      L.TileLayer.prototype.initialize.call(this, ArcGisServerLayer.TILED_TEMPLATE.replace('{{url}}', u), config);
    } else {
      this.getTileUrl = function(tilePoint) {
        var hW = 256,
            x = tilePoint.x,
            y = tilePoint.y,
            z = tilePoint.z,
            u = config.url + '/export?dpi=96&transparent=true&format=png8&bbox=' + ((x * hW) * 360 / (hW * Math.pow(2, z)) - 180) + ',' + (Math.asin((Math.exp((0.5 - ((y + 1) * hW) / (hW) / Math.pow(2, z)) * 4 * Math.PI) - 1) / (Math.exp((0.5 - ((y + 1) * hW) / 256 / Math.pow(2, z)) * 4 * Math.PI) + 1)) * 180 / Math.PI) + ',' + (((x + 1) * hW) * 360 / (hW * Math.pow(2, z)) - 180) + ',' + (Math.asin((Math.exp((0.5 - (y * hW) / (hW) / Math.pow(2, z)) * 4 * Math.PI) - 1) / (Math.exp((0.5 - (y * hW) / 256 / Math.pow(2, z)) * 4 * Math.PI) + 1)) * 180 / Math.PI) + '&bboxSR=4326&imageSR=102100&size=256,256&f=image';

        if (this._layers) {
          u += '&layers=show:' + this._layers;
        }

        return u;
      };
      L.TileLayer.prototype.initialize.call(this, undefined, config);
    }

    if (this.options.dynamicAttribution && this.options.dynamicAttribution.indexOf('http') === 0) {
      util.request(this.options.dynamicAttribution, function(error, response) {
        this._dynamicAttributionData = response.contributors;
        this._map.on('viewreset zoomend dragend', this._updateAttribution, this);
        this.on('load', this._updateAttribution, this);
      });
    }

    reqwest({
      success: function(response) {
        me._metadata = response;
        me.fire('metadata', response);
      },
      type: 'jsonp',
      url: config.url + '?f=json'
    });

    return this;
  },
  /**
   * Called when the layer is added to the map.
   * @param {Object} map
   */
  onAdd: function(map) {
    // TODO: Filter out if zIndex === 0.
    if ((typeof this.options.popup === 'undefined' || this.options.popup !== false)) {
      this._isIdentifiable = true;
      map.on('click', this._handleClick, this);
    } else {
      this._isIdentifiable = false;
    }

    L.TileLayer.prototype.onAdd.call(this, map);
  },
  /**
   * Called when the layer is removed from the map.
   * @param {Object} map
   */
  onRemove: function(map) {
    if (this._dynamicAttributionData) {
      this._removeAttribution();
      this.off('load', this._updateAttribution, this);
      this._map.off('viewreset zoomend dragend', this._updateAttribution, this);
    }

    if (this._isIdentifiable) {
      map.off('click', this._identify);
    }

    L.TileLayer.prototype.onRemove.call(this, map);
  }
});

module.exports = function(config) {
  return new ArcGisServerLayer(config);
};