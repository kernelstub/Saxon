use reqwest::Client;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use super::{MusicFolder, NavidromeServerConfig, ScanResult, Track};

fn rest_base(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/rest") {
        trimmed.to_string()
    } else {
        format!("{}/rest", trimmed)
    }
}

fn normalize_endpoint(endpoint: &str) -> String {
    let endpoint = endpoint.trim_start_matches('/');
    if endpoint.ends_with(".view") {
        endpoint.to_string()
    } else {
        format!("{endpoint}.view")
    }
}

fn endpoint_url(base_url: &str, endpoint: &str) -> String {
    format!("{}/{}", rest_base(base_url), normalize_endpoint(endpoint))
}

fn client_query() -> Vec<(String, String)> {
    vec![
        ("v".to_string(), "1.16.1".to_string()),
        ("c".to_string(), "Saxon".to_string()),
        ("f".to_string(), "json".to_string()),
    ]
}

fn auth_query(server: &NavidromeServerConfig) -> Vec<(String, String)> {
    if let Some(api_key) = server.api_key.as_ref().filter(|k| !k.trim().is_empty()) {
        vec![("apiKey".to_string(), api_key.clone())]
    } else {
        vec![
            ("u".to_string(), server.username.clone()),
            ("t".to_string(), server.token.clone()),
            ("s".to_string(), server.salt.clone()),
        ]
    }
}

fn request_query(server: &NavidromeServerConfig) -> Vec<(String, String)> {
    let mut query = client_query();
    query.extend(auth_query(server));
    query
}

async fn subsonic_get(
    client: &Client,
    server: &NavidromeServerConfig,
    endpoint: &str,
    params: Vec<(String, String)>,
) -> Result<Value, String> {
    let mut query = request_query(server);
    query.extend(params);

    let url = endpoint_url(&server.base_url, endpoint);
    let response = client
        .get(url)
        .query(&query)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let sr = json
        .get("subsonic-response")
        .ok_or_else(|| "Missing subsonic-response".to_string())?;

    let status = sr
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("failed");
    if status != "ok" {
        let message = sr
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Request failed");
        return Err(message.to_string());
    }

    Ok(sr.clone())
}

fn value_to_vec(value: Option<&Value>) -> Vec<&Value> {
    match value {
        Some(Value::Array(arr)) => arr.iter().collect(),
        Some(Value::Object(_)) => value.into_iter().collect(),
        _ => Vec::new(),
    }
}

fn value_to_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        _ => None,
    }
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

pub async fn ping(server: &NavidromeServerConfig) -> Result<bool, String> {
    let client = Client::new();
    let sr = subsonic_get(&client, server, "ping", Vec::new()).await?;
    Ok(sr
        .get("openSubsonic")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

fn cover_art_url(server: &NavidromeServerConfig, cover_id: &str) -> String {
    let mut query = request_query(server);
    query.push(("id".to_string(), cover_id.to_string()));
    query.push(("size".to_string(), "300".to_string()));
    let url = endpoint_url(&server.base_url, "getCoverArt");
    let query_string = serde_urlencoded::to_string(query).unwrap_or_default();
    format!("{}?{}", url, query_string)
}

fn stream_url(server: &NavidromeServerConfig, track_id: &str) -> String {
    let mut query = request_query(server);
    query.push(("id".to_string(), track_id.to_string()));
    let url = endpoint_url(&server.base_url, "stream");
    let query_string = serde_urlencoded::to_string(query).unwrap_or_default();
    format!("{}?{}", url, query_string)
}

pub async fn scan_library(server: &NavidromeServerConfig) -> Result<ScanResult, String> {
    let client = Client::new();

    let root_id = format!("navidrome:{}", server.id);
    let all_tracks_folder_id = format!("navidrome:{}:alltracks", server.id);
    let artists_root_folder_id = format!("navidrome:{}:artists", server.id);
    let playlists_root_folder_id = format!("navidrome:{}:playlists", server.id);
    let mut folders: Vec<MusicFolder> = Vec::new();
    let mut tracks: Vec<Track> = Vec::new();

    let mut folder_track_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut hasher = DefaultHasher::new();
    let mut library_track_total = 0usize;

    folders.push(MusicFolder {
        id: root_id.clone(),
        parent_id: None,
        name: server.name.clone(),
        path: root_id.clone(),
        track_count: 0,
        source: "navidrome".to_string(),
    });

    folders.push(MusicFolder {
        id: all_tracks_folder_id.clone(),
        parent_id: Some(root_id.clone()),
        name: "All Tracks".to_string(),
        path: all_tracks_folder_id.clone(),
        track_count: 0,
        source: "navidrome".to_string(),
    });

    folders.push(MusicFolder {
        id: artists_root_folder_id.clone(),
        parent_id: Some(root_id.clone()),
        name: "Artists".to_string(),
        path: artists_root_folder_id.clone(),
        track_count: 0,
        source: "navidrome".to_string(),
    });

    folders.push(MusicFolder {
        id: playlists_root_folder_id.clone(),
        parent_id: Some(root_id.clone()),
        name: "Playlists".to_string(),
        path: playlists_root_folder_id.clone(),
        track_count: 0,
        source: "navidrome".to_string(),
    });

    let artists_sr = subsonic_get(&client, server, "getArtists", Vec::new()).await?;
    let indexes = value_to_vec(artists_sr.get("artists").and_then(|a| a.get("index")));

    for index in indexes {
        let artists = value_to_vec(index.get("artist"));
        for artist in artists {
            let artist_id = match value_to_string(artist.get("id")) {
                Some(v) => v,
                None => continue,
            };
            let artist_name = value_to_string(artist.get("name")).unwrap_or_else(|| "Unknown Artist".to_string());
            let artist_folder_id = format!("navidrome:{}:artist:{}", server.id, artist_id);

            folders.push(MusicFolder {
                id: artist_folder_id.clone(),
                parent_id: Some(artists_root_folder_id.clone()),
                name: artist_name.clone(),
                path: artist_folder_id.clone(),
                track_count: 0,
                source: "navidrome".to_string(),
            });

            let artist_sr = subsonic_get(
                &client,
                server,
                "getArtist",
                vec![("id".to_string(), artist_id.clone())],
            )
            .await?;

            let artist_obj = artist_sr.get("artist");
            let albums = value_to_vec(artist_obj.and_then(|a| a.get("album")));

            for album in albums {
                let album_id = match value_to_string(album.get("id")) {
                    Some(v) => v,
                    None => continue,
                };
                let album_name = value_to_string(album.get("name")).unwrap_or_else(|| "Unknown Album".to_string());
                let album_cover = value_to_string(album.get("coverArt"));
                let album_folder_id = format!("navidrome:{}:album:{}", server.id, album_id);

                folders.push(MusicFolder {
                    id: album_folder_id.clone(),
                    parent_id: Some(artist_folder_id.clone()),
                    name: album_name.clone(),
                    path: album_folder_id.clone(),
                    track_count: 0,
                    source: "navidrome".to_string(),
                });

                let album_sr = subsonic_get(
                    &client,
                    server,
                    "getAlbum",
                    vec![("id".to_string(), album_id.clone())],
                )
                .await?;

                let album_obj = album_sr.get("album");
                let songs = value_to_vec(album_obj.and_then(|a| a.get("song")));
                let mut album_count = 0usize;

                for song in songs {
                    let song_id = match value_to_string(song.get("id")) {
                        Some(v) => v,
                        None => continue,
                    };
                    let title = value_to_string(song.get("title")).unwrap_or_else(|| "Unknown Title".to_string());
                    let duration = value_to_u64(song.get("duration")).unwrap_or(0);
                    let song_artist =
                        value_to_string(song.get("artist")).unwrap_or_else(|| artist_name.clone());
                    let song_album =
                        value_to_string(song.get("album")).unwrap_or_else(|| album_name.clone());
                    let cover_id =
                        value_to_string(song.get("coverArt")).or_else(|| album_cover.clone());

                    let cover_url = cover_id.as_deref().map(|cid| cover_art_url(server, cid));
                    let audio_url = stream_url(server, &song_id);
                    let id = format!("navidrome:{}:track:{}", server.id, song_id);

                    id.hash(&mut hasher);
                    album_folder_id.hash(&mut hasher);
                    title.hash(&mut hasher);
                    song_artist.hash(&mut hasher);
                    song_album.hash(&mut hasher);
                    duration.hash(&mut hasher);

                    tracks.push(Track {
                        canonical_id: id.clone(),
                        id,
                        title,
                        artist: song_artist,
                        album: song_album,
                        duration,
                        cover_url,
                        audio_url,
                        folder_id: Some(album_folder_id.clone()),
                        source: "navidrome".to_string(),
                    });

                    album_count += 1;
                }

                folder_track_counts.insert(album_folder_id.clone(), album_count);
                *folder_track_counts.entry(artist_folder_id.clone()).or_insert(0) += album_count;
                library_track_total += album_count;
            }
        }
    }

    if library_track_total > 0 {
        folder_track_counts.insert(all_tracks_folder_id.clone(), library_track_total);
        folder_track_counts.insert(artists_root_folder_id.clone(), library_track_total);
        folder_track_counts.insert(root_id.clone(), library_track_total);
    }

    let playlists_sr = subsonic_get(&client, server, "getPlaylists", Vec::new()).await?;
    let playlists = value_to_vec(playlists_sr.get("playlists").and_then(|p| p.get("playlist")));
    let mut playlist_total = 0usize;
    for playlist in playlists {
        let playlist_id = match value_to_string(playlist.get("id")) {
            Some(v) => v,
            None => continue,
        };
        let playlist_name =
            value_to_string(playlist.get("name")).unwrap_or_else(|| "Playlist".to_string());
        let playlist_folder_id = format!("navidrome:{}:playlist:{}", server.id, playlist_id);

        folders.push(MusicFolder {
            id: playlist_folder_id.clone(),
            parent_id: Some(playlists_root_folder_id.clone()),
            name: playlist_name.clone(),
            path: playlist_folder_id.clone(),
            track_count: 0,
            source: "navidrome".to_string(),
        });

        let playlist_sr = subsonic_get(
            &client,
            server,
            "getPlaylist",
            vec![("id".to_string(), playlist_id.clone())],
        )
        .await?;

        let playlist_obj = playlist_sr.get("playlist");
        let entries = value_to_vec(playlist_obj.and_then(|p| p.get("entry")));
        let mut playlist_count = 0usize;

        for entry in entries {
            let song_id = match value_to_string(entry.get("id")) {
                Some(v) => v,
                None => continue,
            };
            let base_id = format!("navidrome:{}:track:{}", server.id, song_id);
            let id = format!("navidrome:{}:playlist:{}:track:{}", server.id, playlist_id, song_id);
            let title = value_to_string(entry.get("title")).unwrap_or_else(|| "Unknown Title".to_string());
            let duration = value_to_u64(entry.get("duration")).unwrap_or(0);
            let song_artist =
                value_to_string(entry.get("artist")).unwrap_or_else(|| "Unknown Artist".to_string());
            let song_album =
                value_to_string(entry.get("album")).unwrap_or_else(|| "Unknown Album".to_string());
            let cover_id = value_to_string(entry.get("coverArt"));

            let cover_url = cover_id.as_deref().map(|cid| cover_art_url(server, cid));
            let audio_url = stream_url(server, &song_id);

            id.hash(&mut hasher);
            base_id.hash(&mut hasher);
            playlist_folder_id.hash(&mut hasher);
            title.hash(&mut hasher);
            song_artist.hash(&mut hasher);
            song_album.hash(&mut hasher);
            duration.hash(&mut hasher);

            tracks.push(Track {
                canonical_id: base_id,
                id,
                title,
                artist: song_artist,
                album: song_album,
                duration,
                cover_url,
                audio_url,
                folder_id: Some(playlist_folder_id.clone()),
                source: "navidrome".to_string(),
            });

            playlist_count += 1;
        }

        folder_track_counts.insert(playlist_folder_id.clone(), playlist_count);
        playlist_total += playlist_count;
    }

    if playlist_total > 0 {
        folder_track_counts.insert(playlists_root_folder_id.clone(), playlist_total);
    }

    for folder in folders.iter_mut() {
        if let Some(count) = folder_track_counts.get(&folder.id).copied() {
            folder.track_count = count;
        }
    }

    let revision = format!("{:016x}", hasher.finish());
    Ok(ScanResult {
        tracks,
        folders,
        revision,
    })
}

