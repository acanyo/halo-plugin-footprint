import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeGalleryImages,
    photoWallImages,
    resolvePhotoWallOptions
} from '../../../main/frontend/footprint/modules/photo-wall.js';

test('normalizeGalleryImages：支持旧字符串、按 order 排序并去掉空地址', () => {
    assert.deepEqual(normalizeGalleryImages([
        { url: '/b.jpg', order: 2 },
        '',
        { thumbnail: '/a.jpg', order: 1 },
        { url: '/ignored.jpg' }
    ]), ['/a.jpg', '/b.jpg', '/ignored.jpg']);
    assert.deepEqual(normalizeGalleryImages(null), []);
});

test('resolvePhotoWallOptions：兼容旧样式别名并限制分页数量', () => {
    assert.deepEqual(resolvePhotoWallOptions({
        enablePhotoWall: true,
        photoWallStyle: 'A',
        photoWallPageSize: 99
    }), { enabled: true, style: 'gallery', pageSize: 12 });
    assert.deepEqual(resolvePhotoWallOptions({
        enablePhotoWall: false,
        photoWallStyle: 'unknown',
        photoWallPageSize: 0
    }), { enabled: false, style: 'original', pageSize: 6 });
});

test('photoWallImages：未配置图片墙时返回空数组', () => {
    assert.deepEqual(photoWallImages({}), []);
});
