import { defaultConfig } from '@formkit/vue'

// 扩展 FormKit 类型定义
declare module '@formkit/vue' {
  interface FormKitInputProps {
    type: 'text' | 'number' | 'email' | 'password' | 'checkbox' | 'radio' | 'textarea' | 'select' | 'file' | 'date' | 'datetime-local' | 'attachment' | string
  }
}

// 导出默认配置
export default defaultConfig 