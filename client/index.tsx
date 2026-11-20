import type { Context } from 'cordis'
import { DiaryBooksPage } from './books'
import { DiaryBookPage } from './book'
import { DiaryPreviewPage } from './preview'
import { DiaryWidget } from './dashboard'
import './styles/variant-depth.css'

export default function apply(ctx: Context) {
  ctx.slots.route({
    path: '/diary',
    component: DiaryBooksPage,
    title: '日记',
    icon: 'notebook-pen',
    order: 60,
    group: 'capabilities',
    groupOrder: 35
  })
  ctx.slots.route({
    path: '/diary/preview',
    component: DiaryPreviewPage,
    hidden: true
  })
  ctx.slots.route({
    path: '/diary/:presetId',
    component: DiaryBookPage,
    hidden: true
  })
  ctx.slots.widget({
    id: 'diary.overview',
    title: '日记',
    description: '每本日记的天数、标记和最近一笔',
    icon: 'notebook-pen',
    link: '/diary',
    size: 'md',
    sizes: ['sm', 'md', 'wide', 'lg', 'tall'],
    optional: true,
    component: DiaryWidget
  })
}
