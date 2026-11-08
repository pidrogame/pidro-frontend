import { describe, expect, it } from 'bun:test';
import { faceTap, pictureChoice, saveFace } from '../../src/features/profile';

const faceUrl = 'https://api.pidro.online/images/faces/b.png';

describe('which picture is chosen', () => {
  it('is the photo whenever the server says there is one, whatever face was picked before', () => {
    expect(
      pictureChoice({ has_photo: true, avatar_face: 'b', avatar_url: 'https://cdn/p.jpg' })
    ).toBe('photo');
  });

  it('is the picked face when there is no photo, though avatar_url carries the face', () => {
    expect(pictureChoice({ has_photo: false, avatar_face: 'b', avatar_url: faceUrl })).toBe('b');
  });

  it('is Face 1 when nothing was picked', () => {
    expect(pictureChoice({ has_photo: false, avatar_face: null, avatar_url: null })).toBe('a');
    expect(pictureChoice(null)).toBe('a');
  });

  it('reads an older server, which sends neither field', () => {
    expect(pictureChoice({ avatar_url: null })).toBe('a');
    expect(pictureChoice({})).toBe('a');
    expect(pictureChoice({ avatar_url: 'https://cdn/p.jpg' })).toBe('photo');
  });
});

describe('a tap on a face', () => {
  it('asks first when a photo is on, even for Face 1', () => {
    expect(faceTap('photo', 'a')).toBe('confirm-remove');
    expect(faceTap('photo', 'b')).toBe('confirm-remove');
  });

  it('saves another face and leaves the chosen one alone', () => {
    expect(faceTap('a', 'b')).toBe('save-face');
    expect(faceTap('b', 'a')).toBe('save-face');
    expect(faceTap('b', 'b')).toBeNull();
  });
});

function recorder() {
  const log = [];
  return {
    log,
    show: (face) => log.push(['show', face]),
    install: (user) => log.push(['install', user.avatar_face]),
  };
}

describe('saving a face', () => {
  it('shows the face before the server answers, then the user it sends back', async () => {
    const io = recorder();
    let answer;
    const saving = saveFace('b', {
      ...io,
      put: (face) => {
        io.log.push(['put', face]);
        return new Promise((resolve) => (answer = resolve));
      },
    });
    expect(io.log).toEqual([
      ['show', 'b'],
      ['put', 'b'],
    ]);
    answer({ id: 'u1', avatar_face: 'b', has_photo: false, avatar_url: faceUrl });
    await saving;
    // The answer lands before the optimistic face is dropped, so nothing flickers back.
    expect(io.log.slice(2)).toEqual([
      ['install', 'b'],
      ['show', null],
    ]);
  });

  it('snaps back and rethrows when the server says no, an older one included', async () => {
    const io = recorder();
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    });
    await expect(
      saveFace('b', {
        ...io,
        put: async () => {
          throw notFound;
        },
      })
    ).rejects.toBe(notFound);
    expect(io.log).toEqual([
      ['show', 'b'],
      ['show', null],
    ]);
  });
});
