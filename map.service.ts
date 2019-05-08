import { Injectable, OnInit, OnDestroy } from '@angular/core';
import * as mapboxgl from 'mapbox-gl';
import * as mapbox from 'mapbox';
import { StoriesService } from './stories.service';
import { BehaviorSubject, Subject, Observable, SubscriptionLike as ISubscription, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { AngularFireDatabase } from '@angular/fire/database';
import { environment } from '../../environments/environment';
import { AdminService } from './admin.service';
import { ProfilesService } from './profiles.service';
import { first, take } from 'rxjs/operators';
import { IStoriesMapDialog, IProfilesMapDialog, IMapLayer, IMapGeoloc, IGeoJson, IGeometry } from 'app/models/map.model';
import { NotificationService } from './notification.service';

// GeoJson class
class GeoJson implements IGeoJson {
  type = 'Feature';
  geometry: IGeometry;
  constructor(public coordinates, public properties?) {
    this.geometry = {
      type: 'Point',
      coordinates
    }
  }
}

// Feature collection class
// tslint:disable-next-line:max-classes-per-file
class FeatureCollection {
  type = 'FeatureCollection'
  constructor(public features: GeoJson[]) { }
}

// tslint:disable-next-line:max-classes-per-file
@Injectable()
export class MapService implements OnInit, OnDestroy {
  isLoading: boolean;
  loadSpinner = new BehaviorSubject<boolean>(true);
  isAdmin: boolean = false;
  layers: IMapLayer[];
  stories: any;
  reporters: any;
  radius: number;
  locationType: string;
  locationArea: number = 2;
  map: mapboxgl.Map;
  geoloc: IMapGeoloc;
  locSubject = new BehaviorSubject<any>('');

  geoLoc = new BehaviorSubject<IMapGeoloc>(null);
  geoLoc$ = this.geoLoc.asObservable()

  // Dialogs for click unclustered point
  storiesDialog = new Subject<IStoriesMapDialog>();
  profilesDialog = new Subject<IProfilesMapDialog>();

  subscription: ISubscription;
  private currentStep = new BehaviorSubject<string>('no-step');
  // No realtime data, only promises, so no need to have subscriptions:
  // private subscriptions: ISubscription[] = [];
  private collections: Observable<any>;

  constructor(
    private notSrv: NotificationService,
    private db: AngularFireDatabase,
    private storiesService: StoriesService,
    private ToastrSrv: ToastrService,
    private profilesSrv: ProfilesService,
    private adminSrv: AdminService) {
    this.adminSrv.getAdminProfile()
      .subscribe(data => this.isAdmin = data)
    this.isLoading = true;
  }

  // tslint:disable-next-line:contextual-life-cycle
  ngOnInit(center?, definedMapId?) {
    this.isLoading = true;
    this.loadSpinner.next(true);
    this.layers = [{
      clusterLevel: 0,
      clusterColor: 'rgba(15, 223, 127, 1)',
      clusterBorder: 'rgba(15, 223, 127, 0.5)',
      clusterSize: 20,
    },
    {
      clusterLevel: 15,
      clusterColor: 'rgba(255, 190, 40, 1)',
      clusterBorder: 'rgba(255, 190, 40, 0.5)',
      clusterSize: 20,
    },
    {
      clusterLevel: 25,
      clusterColor: 'rgba(246, 38, 46, 1)',
      clusterBorder: 'rgba(246, 38, 46, 0.5)',
      clusterSize: 20,
    }
    ]
    mapboxgl.accessToken = 'XXXXXXXXXX';
    const mapClass = document.querySelector('.map-container');
    const mapId = mapClass ? mapClass.getAttribute('id') : this.setMapId(definedMapId);
    this.mapSwitch(mapId, center); // Map type switch
  }

  // Use this if the document cant find the ID because of async loading
  setMapId = (id: string): string => id

  // Switching for map
  mapSwitch(mapId: string, center?) {
    this.isLoading = true;
    let dialogLoad = false;
    let profileMapData;

    switch (mapId) {
      // REPORTERS MAP ON LOAD
      case 'reporters':
        this.map = new mapboxgl.Map({
          container: mapId,
          center: center ? [center.lng, center.lat] : [11.008875, 55.771529],
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 9,
          pitch: 45
        })
        // Zoom controller
        this.map.addControl(new mapboxgl.NavigationControl()); // Zoom
        // Track user position
        this.map.addControl(new mapboxgl.GeolocateControl({ // Find own geoloc
          positionOptions: {
            enableHighAccuracy: true
          },
          trackUserLocation: true
        }));
        // page, hits, feed, mediaType, query, verifiedType, licenseType, startDate, endDate
        this.map.on('load', () => {
          this.map.addSource('reporters', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            },
            cluster: true,
            clusterMaxZoom: 14, // Max zoom to cluster points on
            clusterRadius: 70 // Radius of each cluster when clustering points (defaults to 50)
          });
          this.loadImage();
          this.reporters = this.map.getSource('reporters');
          this.collections = this.db.list(`${environment.environment}/userLocation`).snapshotChanges();
          this.collections
            .pipe(first(), take(1))
            .toPromise()
            .then(data => {
              const result = [];
              data.map((mapdata, i) => {
                profileMapData = mapdata.payload.val();
                const geoObject = {
                  type: 'Feature',
                  geometry: {
                    coordinates: [profileMapData._geoloc.lng, profileMapData._geoloc.lat],
                    type: 'Point'
                  },
                  properties: {
                    id: mapdata.key
                  }
                }
                result[i] = geoObject;
              })

              const collectionObj = new FeatureCollection(result);
              this.reporters.setData(collectionObj);
              if (this.map.getLayer('clusters')) {
                this.storiesDeleteLayers();
                this.storiesAddLayers('reporters');
              } else {
                this.storiesAddLayers('reporters');
              }
              console.log(collectionObj);
              this.isLoading = false;
              console.log('Loaded map sucessfully');
            })

          if (this.isAdmin && !dialogLoad) {
            this.map.on('click', 'unclustered-point', (e) => {
              console.log(e.features)
              const coordinateObj = JSON.parse(JSON.stringify(e.features[0].geometry.coordinates));
              const profileId = e.features[0].properties.id;
              console.log(coordinateObj)
              dialogLoad = true;
              console.log('clicked')
              this.profilesSrv.getProfile(profileId)
                .subscribe((profile) => {
                  console.log(profile)
                  this.profilesDialog.next({
                    isOpen: true,
                    profileId,
                    displayName: profile.displayName,
                    userPicture: profile.userPicture
                  })
                  dialogLoad = false;
                  new mapboxgl.Popup()
                    .setLngLat(coordinateObj)
                    .setHTML(`<div class="byrd-map-dialog-wrapper"></div>`)
                    .addTo(this.map);
                },
                  err => throwError(err))
            })
          }

          // Triggering zoom
          this.map.on('click', 'clusters', e => {
            const zoomLevel = this.map.getZoom();
            this.flyTo(e.features[0].geometry.coordinates, this.checkZoom(zoomLevel, e.features[0].properties.point_count));
          })
        })
        break;

      // FOR STORIES ON LOAD!
      case 'stories': // FOR REGULAR MAP
        this.map = new mapboxgl.Map({
          container: mapId,
          center: center ? [center.lng, center.lat] : [11.008875, 55.771529],
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 9,
          pitch: 45
        })
        this.map.addControl(new mapboxgl.NavigationControl()); // Zoom
        this.map.addControl(new mapboxgl.GeolocateControl({ // Find own geoloc
          positionOptions: {
            enableHighAccuracy: true
          },
          trackUserLocation: true
        }));
        this.map.on('load', () => {
          this.map.addSource('stories', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            },
            cluster: true,
            clusterMaxZoom: 14, // Max zoom to cluster points on
            clusterRadius: 70 // Radius of each cluster when clustering points (defaults to 50)
          });
          this.loadImage();
          this.stories = this.map.getSource('stories');
          this.collections = this.db.list(`${environment.environment}/storyLocation`).snapshotChanges();
          this.collections
            .pipe(first())
            .toPromise()
            .then(data => {
              console.log('Loading map...');
              this.isLoading = true;
              const result = [];
              data.map((markers, i) => {
                const centerLoc = markers.payload.val();
                const geoObject = {
                  type: 'Feature',
                  geometry: {
                    coordinates: [centerLoc._geoloc.lng, centerLoc._geoloc.lat],
                    type: 'Point'
                  },
                  properties: {
                    id: markers.key
                  }
                }
                result[i] = geoObject;
              });
              const collectionObj = new FeatureCollection(result);
              this.stories.setData(collectionObj);
              if (this.map.getLayer('clusters')) {
                this.storiesDeleteLayers();
                this.storiesAddLayers('stories');
              } else {
                this.storiesAddLayers('stories');
              }
              console.log(collectionObj);
              console.log('Loaded map sucessfully');
              this.isLoading = false;
            })
            .catch(err => console.log(err))
          // Triggering zoom
          this.map.on('click', 'clusters', e => {
            const zoomLevel = this.map.getZoom();
            this.flyTo(e.features[0].geometry.coordinates, this.checkZoom(zoomLevel, e.features[0].properties.point_count));
          });
          // Popup triggering
          this.map.on('click', 'unclustered-point', e => {
            const storyID = e.features[0].properties.id;
            const coordinateObj = JSON.parse(JSON.stringify(e.features[0].geometry.coordinates));
            this.storiesService.getSpecificStory(storyID)
              .subscribe((story) => {
                this.storiesDialog.next({
                  isOpen: true,
                  mediaType: story.storyMediaType,
                  storyThumbnail: story.storyThumbnail,
                  storyThumbnailImage: story.storyThumbnailImage,
                  displayName: story.displayName,
                  timeAgo: story.uploadDate,
                  storyHeadline: story.storyHeadline,
                  profileId: story.userId
                })
                new mapboxgl.Popup()
                  .setLngLat(coordinateObj)
                  .setHTML(`<div class="byrd-map-dialog-wrapper"></div>`)
                  .addTo(this.map)
              })
          });
          // Change the cursor
          function changeCursor(item, map) {
            map.on('mouseenter', item, () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', item, () => {
              map.getCanvas().style.cursor = '';
            });
          }
          changeCursor('clusters', this.map);
          changeCursor('unclustered-point', this.map);
        })
        break;

      // FOR ASSIGNMENT MAP LOAD!!
      case 'assignment-map': // FOR ASSIGNMENT MAP
        this.map = new mapboxgl.Map({
          container: mapId,
          center: center ? center : [11.008875, 55.771529],
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 10,
          pitch: 45
        })
        // Zoom controller
        this.map.addControl(new mapboxgl.NavigationControl()); // Zoom
        // Track user position
        this.map.addControl(new mapboxgl.GeolocateControl({ // Find own geoloc
          positionOptions: {
            enableHighAccuracy: true
          },
          trackUserLocation: true
        }));
        // Load map
        this.map.on('load', () => {
          this.map.addSource('reporters', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            },
            cluster: true,
            clusterMaxZoom: 14, // Max zoom to cluster points on
            clusterRadius: 70 // Radius of each cluster when clustering points (defaults to 50)
          });
          this.loadImage();
          this.reporters = this.map.getSource('reporters');
          this.collections = this.db.list(`${environment.environment}/userLocation`).snapshotChanges();
          this.collections
            .pipe(take(1))
            .toPromise()
            .then(data => {
              console.log('Loading map...');
              this.isLoading = true;
              const result = [];
              data.map((markers, i) => {
                const centerMarker = markers.payload.val();
                const geoObject = {
                  type: 'Feature',
                  geometry: {
                    coordinates: [centerMarker._geoloc.lng, centerMarker._geoloc.lat],
                    type: 'Point'
                  },
                  properties: {
                    id: markers.key
                  }
                }
                result[i] = geoObject;
              });
              const collectionObj = new FeatureCollection(result);
              this.reporters.setData(collectionObj);
              if (this.map.getLayer('clusters')) {
                this.storiesDeleteLayers();
                this.storiesAddLayers('reporters');
              } else {
                this.storiesAddLayers('reporters');
              }
              console.log(collectionObj);
              console.log('Loaded map sucessfully');
              this.isLoading = false;
            })
            .catch(err => console.log(err))
        });

        // Set area on the map
        this.map.on('click', e => {
          const step = this.currentStep.getValue();
          if (step === 'step-1') {
            this.geoloc = e.lngLat;
            this.addCircleSetLoc(this.geoloc, 'reverse', 'direct', this.locationArea);
          } else if (step !== 'step-1' && step !== 'no-step') {
            this.ToastrSrv.info('Go back to Step 1 to change location', `Can't set location`);
          } else if (step === 'no-step') {
            return false;
          }
        });

        this.map.on('click', 'clusters', e => {
          const zoomLevel = this.map.getZoom();
          this.flyTo(e.features[0].geometry.coordinates, this.checkZoom(zoomLevel, e.features[0].properties.point_count));
        });
        break;

      // FOR VIEW STORY MAP
      case 'view-story':
        this.map = new mapboxgl.Map({
          container: 'view-story',
          center,
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 12,
          pitch: 45
        })
        // Load map
        this.map.on('load', () => {
          console.log('Loaded map sucessfully');
          this.isLoading = true;
          const markerElement = document.createElement('div');
          markerElement.className = 'marker';
          markerElement.innerHTML = `<img src="assets/images/logos/pngs/byrdmarker-view-story.png" style="height:45px; width: 45px;">`;
          new mapboxgl.Marker(markerElement).setLngLat(center).addTo(this.map);
          this.isLoading = false;
        })
        break;

      case 'assignment':
        this.map = new mapboxgl.Map({
          container: 'assignment',
          center,
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 12,
          pitch: 45
        })
        // Load map
        this.map.on('load', () => {
          console.log('Loaded map sucessfully');
          this.isLoading = true;
          const markerElement = document.createElement('div');
          markerElement.className = 'marker';
          markerElement.innerHTML = `<img src="assets/images/logos/pngs/byrdmarker-view-story.png" style="height:45px; width: 45px;">`;
          new mapboxgl.Marker(markerElement).setLngLat(center).addTo(this.map);
          this.isLoading = false;
        })
        break;

      case 'custom-notification':
        this.map = new mapboxgl.Map({
          container: mapId,
          center: center ? center : [11.008875, 55.771529],
          style: 'mapbox://styles/hellobyrd/cj8cs2cko8h9e2roao4ou4gy4',
          zoom: 8,
          pitch: 45
        })
        // Load map
        this.map.on('load', () => {
          this.map.addSource('reporters', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: []
            },
            cluster: true,
            clusterMaxZoom: 10, // Max zoom to cluster points on
            clusterRadius: 120, // Radius of each cluster when clustering points (defaults to 50)
          });
          this.loadImage();
          this.reporters = this.map.getSource('reporters');
          this.collections = this.db.list(`${environment.environment}/userLocation`).snapshotChanges();
          this.collections
            .pipe(first())
            .toPromise()
            .then(data => {
              console.log('Loading map...');
              this.isLoading = true;
              const result = [];
              data.map((markers, i) => {
                const centerMarker = markers.payload.val();
                const geoObject = {
                  type: 'Feature',
                  geometry: {
                    coordinates: [centerMarker._geoloc.lng, centerMarker._geoloc.lat],
                    type: 'Point'
                  },
                  properties: {
                    id: markers.key
                  }
                }
                result[i] = geoObject;
              });
              const collectionObj = new FeatureCollection(result);
              this.reporters.setData(collectionObj);
              if (this.map.getLayer('clusters')) {
                this.storiesDeleteLayers();
                this.storiesAddLayers('reporters');
              } else {
                this.storiesAddLayers('reporters');
              }
              console.log(collectionObj);
              console.log('Loaded map sucessfully');
              this.isLoading = false;
            })
            .catch(err => console.log(err))

        });

        // Set area on the map
        this.map.on('click', (event: any) => {
          this.geoloc = event.lngLat;
          this.addCircleArea(this.geoloc, this.radius);
          this.geoLoc.next(this.geoloc)
        });

        // Set area on the map
        // this.map.on('click', e => {
        //   this.geoloc = e.lngLat;
        //   this.addCircleSetLoc(this.geoloc, 'reverse', 'direct', this.locationArea);
        // });
        break;
    }
  }

  // Zoom calculating
  checkZoom(zoom: number, points: number) {
    return points >= 25 ? zoom + 2 : zoom + 1;
  }
  // Create clusters array
  createArr(color, layers) {
    const arrConstructor = [];
    layers.map((target, i) => {
      switch (color) {
        case 'clusterColor':
          arrConstructor.push([layers[i].clusterLevel, layers[i].clusterColor]);
          break;
        case 'clusterSize':
          arrConstructor.push([layers[i].clusterLevel, layers[i].clusterSize]);
          break;
        case 'clusterBorder':
          arrConstructor.push([layers[i].clusterLevel, layers[i].clusterBorder]);
          break;
      }
    })
    return arrConstructor;
  }
  // Circle factory
  createGeoJSONCircle(geoloc: IMapGeoloc, radiusInKm: number, points?: any) {
    if (!points) { points = 64 };
    const km = radiusInKm;
    const ret = [];
    const distanceX = km / (111.320 * Math.cos(geoloc.lat * Math.PI / 180));
    const distanceY = km / 110.574;
    // tslint:disable-next-line:one-variable-per-declaration
    let theta: number, x: number, y: number;
    for (let i = 0; i < points; i++) {
      theta = (i / points) * (2 * Math.PI);
      x = distanceX * Math.cos(theta);
      y = distanceY * Math.sin(theta);
      ret.push([geoloc.lng + x, geoloc.lat + y]);
    }
    ret.push(ret[0]);
    return {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [ret]
          }
        }]
      }
    };
  }

  // Circle destroy
  deleteGeoJSONCircle(map: mapboxgl.Map, name: string) {
    if (map.getSource(name) && map.getSource(name) !== undefined) {
      // console.log(map.getSource(name))
      map.removeLayer(name);
      map.removeSource(name);
    }
  }
  // Filter
  filterResult(features: any, key) {
    const array = features.filter((item) => {
      if (item.place_type[0] === key) {
        this.geoloc = {
          lat: item.center[1],
          lng: item.center[0]
        }
        return true;
      } else {
        return false;
      }
    });
    return array;
  }

  // For notification
  addCircleArea(geoloc: IMapGeoloc, radius: number) {
    this.drawCircle(radius)
    console.log(geoloc)
  }

  // Switch case of adding circle
  addCircleSetLoc(geoloc: IMapGeoloc, direction: string, status: string, locationArea: number) {
    console.log({ geoloc, direction, status, locationArea });
    this.geoloc = geoloc;
    if (direction === 'reverse') {
      this.findAddress(geoloc, null, 'reverse').then((res) => {
        switch (this.locationType) {
          default:
            let noSelection = res.entity.features;
            noSelection = this.filterResult(noSelection, 'place');
            if (noSelection.length === 0) {
              this.errorMessage();
            } else {
              this.locSubject.next(noSelection[0]);
            }
            break;
          case 'ByCity':
            let city = res.entity.features;
            if (city.length < 3) {
              city = this.filterResult(city, 'country');
            } else {
              city = this.filterResult(city, 'place');
            }
            if (city.length === 0) {
              this.errorMessage();
            } else {
              this.locSubject.next(city[0]);
            }
            break;
          case 'ByCountry':
            let country = res.entity.features;
            country = this.filterResult(country, 'country');
            if (country.length === 0) {
              this.errorMessage();
            } else {
              this.locSubject.next(country[0]);
            }
            break;
          case 'ByPin':
            let pin = res.entity.features;
            if (pin.length < 4) {
              pin = this.filterResult(pin, 'place');
            } else {
              pin = this.filterResult(pin, 'place');
            }
            if (pin.length === 0) {
              this.errorMessage();
            } else {
              this.locSubject.next(pin[0]);
            }
            break;

        }
        if (status === 'area') {
          console.log('area');
          this.drawCircle(locationArea);
        }
      })
    }
    if (status === 'direct') {
      console.log('direct')
      this.drawCircle(locationArea);
    }
  }

  // Find circle address
  findAddress(geoloc: IMapGeoloc, name: string, direction: string) {
    this.geoloc = geoloc;
    const client = new mapbox(mapboxgl.accessToken);
    if (direction === 'reverse') {
      return client.geocodeReverse({
        latitude: this.geoloc.lat,
        longitude: this.geoloc.lng
      }, (err, res) => res);
    } else if (direction === 'forward') {
      return client.geocodeForward(name, (err, res) => res);
    }
  }

  // Draw Circle
  drawCircle(locationArea: number) {
    console.log('drawCircle')
    this.deleteGeoJSONCircle(this.map, 'polygon'); // Delete old circle
    this.deleteGeoJSONCircle(this.map, 'marker'); // Delete old marker
    this.map.addSource('polygon', this.createGeoJSONCircle(this.geoloc, locationArea));
    this.map.addLayer({
      id: 'polygon',
      type: 'fill',
      source: 'polygon',
      layout: {},
      paint: {
        'fill-color': '#ff565d',
        'fill-opacity': 0.6
      }
    });

    this.map.addSource('marker', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [this.geoloc.lng, this.geoloc.lat]
          }
        }]
      }
    })
    this.map.addLayer({
      id: 'marker',
      type: 'symbol',
      source: 'marker',
      layout: {
        'icon-image': 'byrdmarker',
        'icon-size': 0.8
      }
    })
  }

  // Error message
  errorMessage() {
    this.ToastrSrv.error('No location found');
  }
  // LoacationType
  locationTypeCheck(type: string, area: string, geoloc: IMapGeoloc) {
    if (geoloc) { this.geoloc = geoloc };
    this.locationType = type;
    this.locationArea = parseInt(area);
    if (this.map.getSource('polygon') && this.geoloc) {
      this.addCircleSetLoc(this.geoloc, 'reverse', 'area', this.locationArea);
    }
  }
  // Set current Step
  setStep(step) {
    this.currentStep.next(step);
  }
  // Return observable with place_name
  getMapValue(): Observable<any> {
    return this.locSubject.asObservable();
  }
  storiesDialogOpen(): Observable<IStoriesMapDialog> {
    return this.storiesDialog.asObservable();
  }
  profilesDialogOpen(): Observable<IProfilesMapDialog> {
    return this.profilesDialog.asObservable();
  }

  // Fly to
  flyTo(center, zoom) {
    this.map.flyTo({
      center,
      zoom,
      speed: 1,
      curve: 3
    });
  }

  // Adding stories layer
  storiesAddLayers(source) {
    this.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': {
          property: 'point_count',
          type: 'interval',
          stops: this.createArr('clusterColor', this.layers)
        },
        'circle-radius': {
          property: 'point_count',
          type: 'interval',
          stops: this.createArr('clusterSize', this.layers)
        },
        'circle-stroke-width': 5,
        'circle-stroke-color': {
          property: 'point_count',
          type: 'interval',
          stops: this.createArr('clusterBorder', this.layers)
        }
      }
    });
    this.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 14
      },
      paint: {
        'text-color': '#FFFFFF'
      }
    });
    this.map.addLayer({
      id: 'unclustered-point',
      type: 'symbol',
      source,
      filter: ['!has', 'point_count'],
      layout: {
        'icon-image': 'byrdmarker',
        'icon-size': 0.8
      }
    });
  }
  // Delete stories layer
  storiesDeleteLayers() {
    this.map.removeLayer('clusters');
    this.map.removeLayer('cluster-count');
    this.map.removeLayer('unclustered-point');
  }
  // Load byrdmarker
  loadImage() {
    this.map.loadImage('assets/images/logos/pngs/byrd-marker.png', (error, image) => {
      if (error) {
        throw error
      };
      this.map.addImage('byrdmarker', image);
    });
  }

  ngOnDestroy() {
    /** no relevance to unsubscribe, because no more realtime data - only promises */

    // if (this.subscriptions) {
    //   console.log('destroyed map started')
    //   this.subscriptions.map((sub, i) => {
    //     sub.unsubscribe();
    //     console.log(`unsubscribe from subs ${i + 1}`);
    //   })
    //   console.log('destroyed map done')
    // }
  }
}
