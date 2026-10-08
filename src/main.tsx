import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Any API call rejected for a missing/expired owner session sends VECTOR back to the lock screen.
const nativeFetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const res = await nativeFetch(...args)
  if (res.status === 401 && res.headers.get('X-Vector-Auth') === 'required') {
    window.dispatchEvent(new Event('vector:auth-required'))
  }
  return res
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
