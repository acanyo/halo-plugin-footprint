/**
 * 页面元素入场动画与按钮的点击 / 波纹 / 提示效果。
 */

// 优化动画性能
export const showElements = () => {
    // 添加初始类
    document.body.classList.add('theme-ready');

    // 动画序列
    const animationSequence = [
        {
            element: '.logo-container',
            className: 'show',
            delay: 0
        },
        {
            element: '.map-controls',
            className: 'show',
            delay: 200,
            callback: () => {
                // 依次显示控制按钮
                const buttons = document.querySelectorAll('.map-controls .control-btn');
                buttons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        // 添加缩放效果
                        btn.classList.add('scale-in');
                        // 移除缩放效果
                        setTimeout(() => btn.classList.remove('scale-in'), 300);
                    }, index * 100);
                });
            }
        },
        {
            element: '.zoom-controls',
            className: 'show',
            delay: 400,
            callback: () => {
                const zoomButtons = document.querySelectorAll('.zoom-controls button');
                zoomButtons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        btn.classList.add('slide-in');
                        setTimeout(() => btn.classList.remove('slide-in'), 300);
                    }, index * 100);
                });
            }
        }
    ];

    // 执行动画序列
    animationSequence.forEach(({element, className, delay, callback}) => {
        setTimeout(() => {
            const el = document.querySelector(element);
            if (el) {
                el.classList.add(className);
                if (callback) {
                    callback();
                }
            }
        }, delay);
    });

// 为底部工具栏添加进入动画
    const mapControls = document.querySelector('.map-controls');
    if (mapControls) {
        setTimeout(() => {
            const buttons = mapControls.querySelectorAll('button, .control-btn, #timeline-btn, #messageBoards');
            buttons.forEach((btn, index) => {
                setTimeout(() => {
                    btn.classList.add('animate-in');
                    // 添加波纹效果和提示
                    addRippleEffect(btn);

                    // 添加点击脉冲效果
                    btn.addEventListener('click', () => {
                        btn.classList.add('btn-pulse');
                        setTimeout(() => {
                            btn.classList.remove('btn-pulse');
                        }, 300);
                    });
                }, 600 + (index * 120)); // 增加延迟和间隔，使动画更平滑
            });
        }, 800);
    }
};

// 添加按钮点击动画
export const addButtonAnimation = (button) => {
    button.addEventListener('click', () => {
        button.classList.add('btn-pulse');
        setTimeout(() => {
            button.classList.remove('btn-pulse');
        }, 300);
    });

    // 添加波纹效果
    addRippleEffect(button);

    // 添加悬停提示
    if (button.dataset.tooltip) {
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = button.dataset.tooltip;
        button.appendChild(tooltip);

        button.addEventListener('mouseenter', () => {
            tooltip.classList.add('show');
        });

        button.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });

        // 移动端没有稳定的 mouseleave，点击后主动关闭提示，避免气泡残留
        button.addEventListener('click', () => {
            tooltip.classList.remove('show');
        });

        button.addEventListener('touchstart', () => {
            tooltip.classList.remove('show');
        }, {passive: true});
    }
};

// 添加按钮波纹效果
export const addRippleEffect = (button) => {
    button.addEventListener('click', function (e) {
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        button.appendChild(ripple);

        setTimeout(() => {
            ripple.remove();
        }, 600);
    });
};
