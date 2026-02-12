import './style.css'
import rocketLogo from '/rocket.png'

document.querySelector('#app').innerHTML = `
  <div>
    <img src="${rocketLogo}" class="logo" alt="Discord" width="400" height="280" />
    <h1>Hello, World!</h1>
  </div>
`;